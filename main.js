"use strict";

const dgram = require("dgram");
const { Plugin } = require("@lumiastream/plugin");

const REQUEST_TIMEOUT_MS = 5000;
const ALERT_KEY = "switchSong";
const MDNS_ADDR = "224.0.0.251";
const MDNS_PORT = 5353;
const WNP_SERVICE = "_whatsnowplaying._tcp.local.";
const MDNS_TIMEOUT_MS = 3000;
const RECONNECT_DELAY_MS = 5000;

const VARS = [
  "title", "artist", "album", "albumartist", "genre", "date",
  "bpm", "key", "label", "comments", "duration", "duration_hhmmss", "duration_sec",
  "isrc", "coverurl", "filename", "track", "track_total",
  "composer", "deck", "requester", "requestdisplayname", "artistshortbio",
];

const CRITICAL_VARS = new Set(["title", "artist"]);

// ── mDNS discovery ───────────────────────────────────────────────────────────

function encodeDnsName(fqdn) {
  const parts = fqdn.replace(/\.$/, "").split(".").map((label) => {
    const b = Buffer.from(label, "utf8");
    return Buffer.concat([Buffer.from([b.length]), b]);
  });
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

function buildPtrQuery(serviceType) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(1, 4); // QDCOUNT = 1
  return Buffer.concat([header, encodeDnsName(serviceType), Buffer.from([0, 12, 0, 1])]);
}

function decodeDnsName(buf, offset) {
  const labels = [];
  let pos = offset;
  let end = -1;
  let hops = 0;
  while (pos < buf.length && hops++ < 128) {
    const len = buf[pos];
    if (len === 0) {
      if (end < 0) end = pos + 1;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      if (end < 0) end = pos + 2;
      pos = ((len & 0x3f) << 8) | buf[pos + 1];
      continue;
    }
    labels.push(buf.subarray(pos + 1, pos + 1 + len).toString("utf8"));
    pos += 1 + len;
  }
  return { name: labels.join("."), end: end < 0 ? pos + 1 : end };
}

function parseMdnsPacket(buf) {
  if (buf.length < 12) return null;
  if (!(buf.readUInt16BE(2) & 0x8000)) return null;

  const qdcount = buf.readUInt16BE(4);
  const ancount = buf.readUInt16BE(6);
  const nscount = buf.readUInt16BE(8);
  const arcount = buf.readUInt16BE(10);

  let pos = 12;
  for (let i = 0; i < qdcount && pos < buf.length; i++) {
    pos = decodeDnsName(buf, pos).end + 4;
  }

  const srvRecords = [];
  const aRecords = {};

  for (let i = 0; i < ancount + nscount + arcount && pos + 10 < buf.length; i++) {
    const { name, end } = decodeDnsName(buf, pos);
    pos = end;
    const type = buf.readUInt16BE(pos);
    const rdlen = buf.readUInt16BE(pos + 8);
    const rd = pos + 10;
    pos = rd + rdlen;

    if (rd + rdlen > buf.length) break;
    if (type === 33 && rdlen > 6 && rd + 6 <= buf.length) {
      const port = buf.readUInt16BE(rd + 4);
      const { name: target } = decodeDnsName(buf, rd + 6);
      srvRecords.push({ port, target, name });
    } else if (type === 1 && rdlen === 4 && rd + 4 <= buf.length) {
      aRecords[name.toLowerCase()] = `${buf[rd]}.${buf[rd+1]}.${buf[rd+2]}.${buf[rd+3]}`;
    }
  }

  return { srvRecords, aRecords };
}

function discoverWNP(timeoutMs) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    let done = false;
    const srvMap = new Map();
    const aMap = {};

    const tryResolve = () => {
      for (const [target, port] of srvMap) {
        const ip = aMap[target];
        if (ip) { finish({ host: ip, port }); return; }
      }
    };

    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { sock.close(); } catch {}
      resolve(result);
    };

    const timer = setTimeout(() => {
      for (const [target, port] of srvMap) {
        finish(aMap[target] ? { host: aMap[target], port } : { host: target, port });
        return;
      }
      finish(null);
    }, timeoutMs);

    sock.on("message", (msg) => {
      const p = parseMdnsPacket(msg);
      if (!p) return;
      for (const srv of p.srvRecords) srvMap.set(srv.target.toLowerCase(), srv.port);
      Object.assign(aMap, p.aRecords);
      tryResolve();
    });

    sock.on("error", () => finish(null));

    sock.bind(MDNS_PORT, () => {
      try {
        sock.addMembership(MDNS_ADDR);
        sock.setMulticastLoopback(true);
        const q = buildPtrQuery(WNP_SERVICE);
        sock.send(q, 0, q.length, MDNS_PORT, MDNS_ADDR);
      } catch { finish(null); }
    });
  });
}

// ── Plugin ───────────────────────────────────────────────────────────────────

class WhatsnowplayingPlugin extends Plugin {
  constructor(manifest, context) {
    super(manifest, context);
    this._ws = null;
    this._reconnectTimer = null;
    this._lastKey = null;
    this._discovered = null;
    this._discoveryPromise = null;
  }

  async onload() {
    await this._startDiscovery();
    if (!await this._handshake()) return;
    this._connect();
  }

  onunload() {
    console.log("What's Now Playing plugin unloaded");
    this._disconnect();
  }

  async onsettingsupdate(settings, previous = {}) {
    const hostChanged = String(settings?.hostname) !== String(previous?.hostname);
    const portChanged = String(settings?.port) !== String(previous?.port);
    if (hostChanged || portChanged) {
      console.log("Settings changed — reconnecting");
      this._lastKey = null;
      this._discoveryPromise = null;
      this._disconnect();
      await this._startDiscovery();
      if (await this._handshake()) this._connect();
    }
  }

  _isAuto() {
    const h = String(this.settings?.hostname ?? "").trim().toLowerCase();
    return h === "" || h === "auto";
  }

  _host() {
    if (this._discovered) return this._discovered.host;
    const h = String(this.settings?.hostname ?? "").trim();
    return (!h || h.toLowerCase() === "auto") ? "127.0.0.1" : h;
  }

  _port() {
    if (this._discovered) return this._discovered.port;
    const p = Number(this.settings?.port);
    return Number.isFinite(p) && p > 0 ? p : 8899;
  }

  _startDiscovery() {
    if (this._discoveryPromise) return this._discoveryPromise;
    if (!this._isAuto()) {
      this._discovered = null;
      console.log("Using manual address:", this._host() + ":" + this._port());
      return Promise.resolve();
    }
    this._discoveryPromise = (async () => {
      try {
        console.log("Discovering WNP via mDNS...");
        const found = await discoverWNP(MDNS_TIMEOUT_MS);
        if (found) {
          this._discovered = found;
          console.log("Discovered WNP at", this._discovered.host + ":" + this._discovered.port);
        } else {
          console.log("mDNS discovery timed out — falling back to", this._host() + ":" + this._port());
        }
      } finally {
        this._discoveryPromise = null;
      }
    })();
    return this._discoveryPromise;
  }

  async _handshake() {
    const pluginVersion = this.manifest?.version ?? "0.0.0";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(
        "http://" + this._host() + ":" + this._port() + "/v1/lumia/version?plugin_version=" + encodeURIComponent(pluginVersion),
        { signal: controller.signal },
      );
      if (!response.ok) {
        console.warn("Version handshake failed (HTTP", response.status, ") — continuing anyway");
        return true;
      }
      const data = await response.json();
      if (!data.accepted) {
        console.error("Plugin rejected:", data.message ?? "incompatible version");
        return false;
      }
      console.log("Handshake OK — plugin v" + pluginVersion + ", WNP v" + data.wnp_version);
      return true;
    } catch {
      console.warn("Version handshake unreachable — continuing anyway");
      return true;
    } finally {
      clearTimeout(timeout);
    }
  }

  _connect() {
    this._disconnect();
    const url = "ws://" + this._host() + ":" + this._port() + "/wsstream";
    console.log("Connecting to WNP at", url);

    const ws = new WebSocket(url); // nosemgrep: javascript.lang.security.detect-insecure-websocket
    this._ws = ws;

    ws.onopen = () => {
      console.log("Connected to WNP WebSocket");
    };

    ws.onmessage = (event) => {
      let data;
      try { data = JSON.parse(event.data); } catch { return; }
      if (data.last) return; // WNP shutdown signal — close event will trigger reconnect
      this._handleMetadata(data).catch((e) => console.error("handleMetadata failed:", e));
    };

    ws.onerror = () => {
      console.warn("WebSocket error — will reconnect in", RECONNECT_DELAY_MS / 1000, "s");
    };

    ws.onclose = () => {
      if (this._ws !== ws) return; // intentional disconnect, skip reconnect
      console.log("WebSocket closed — reconnecting in", RECONNECT_DELAY_MS / 1000, "s");
      this._ws = null;
      this._scheduleReconnect();
    };
  }

  _disconnect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._ws) {
      const ws = this._ws;
      this._ws = null; // null first so onclose guard skips reconnect
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      try { ws.close(); } catch {}
    }
  }

  _scheduleReconnect() {
    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      this._lastKey = null;
      await this._startDiscovery();
      if (await this._handshake()) this._connect();
    }, RECONNECT_DELAY_MS);
  }

  async _handleMetadata(data) {
    const vars = this._extractVars(data);
    const trackKey = `${vars.title}\x00${vars.artist}\x00${vars.deck}\x00${vars.filename}`;
    if (trackKey === this._lastKey) return;
    this._lastKey = trackKey; // set now to close the race window before any await

    console.log("Track changed:", '"' + vars.title + '"', "by", vars.artist);
    const results = await Promise.allSettled(VARS.map((name) => this.lumia.setVariable(name, vars[name])));

    let criticalFailed = false;
    const extraSettings = {};
    results.forEach((result, i) => {
      const name = VARS[i];
      if (result.status === "rejected") {
        console.warn("Failed to set variable", '"' + name + '"' + ":", result.reason);
        if (CRITICAL_VARS.has(name)) criticalFailed = true;
      }
      extraSettings["whatsnowplaying_" + name] = vars[name];
    });

    if (criticalFailed) {
      this._lastKey = null; // reset so next message can retry
      console.warn("Skipping alert — critical variables (title/artist) failed to update");
      return;
    }

    await this.lumia.triggerAlert({ alert: ALERT_KEY, extraSettings });
  }

  _extractVars(data) {
    const total = typeof data.duration === "number" ? Math.floor(data.duration) : null;
    const isrcRaw = data.isrc;
    const isrc = Array.isArray(isrcRaw)
      ? (isrcRaw[0] ?? "")
      : (typeof isrcRaw === "string" ? isrcRaw : "");

    const rawCoverurl = data.coverurl ?? "";
    const coverurl = rawCoverurl
      ? (/^https?:\/\//i.test(rawCoverurl)
          ? rawCoverurl
          : "http://" + this._host() + ":" + this._port() + "/" + rawCoverurl.replace(/^\/+/, ""))
      : "";

    return {
      title:              data.title              ?? "",
      artist:             data.artist             ?? "",
      album:              data.album              ?? "",
      albumartist:        data.albumartist        ?? "",
      genre:              data.genre              ?? "",
      date:               data.date               ?? "",
      bpm:                data.bpm                ?? "",
      key:                data.key                ?? "",
      label:              data.label              ?? "",
      comments:           data.comments           ?? "",
      duration:           total !== null
        ? String(Math.floor(total / 60)).padStart(2, "0") + ":" + String(total % 60).padStart(2, "0")
        : "",
      duration_hhmmss:    data.duration_hhmmss    ?? "",
      duration_sec:       total !== null ? String(total) : "",
      isrc,
      coverurl,
      filename:           data.filename           ?? "",
      track:              data.track              ?? "",
      track_total:        data.track_total        ?? "",
      composer:           data.composer           ?? "",
      deck:               data.deck               ?? "",
      requester:          data.requester          ?? "",
      requestdisplayname: data.requestdisplayname ?? "",
      artistshortbio:     data.artistshortbio     ?? "",
    };
  }
}

module.exports = WhatsnowplayingPlugin;
