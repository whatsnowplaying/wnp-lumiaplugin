# What's Now Playing — Lumia Stream Plugin

Connects [What's Now Playing](https://whatsnowplaying.github.io/whats-now-playing/) to
[Lumia Stream](https://lumiastream.com/), exposing full DJ track metadata as Lumia variables
and firing a **Track Changed** alert on every track change.

## Requirements

* What's Now Playing with the **Web Server** output enabled
* Lumia Stream 9.0 or newer

## Installation

1. Download `whatsnowplaying-X.Y.Z.lumiaplugin` from the
   [latest release](https://github.com/whatsnowplaying/wnp-lumiaplugin/releases/latest).
2. In Lumia Stream, open **Plugins → Add Manually** and select the downloaded file.
3. Enable the **What's Now Playing** plugin in the Plugins list.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| WNP Hostname | `auto` | Set to `auto` to discover WNP on the network via mDNS. Enter an IP address to connect to a specific machine. |
| WNP Port | `8899` | Port WNP's web server is running on. Change only if you customized the WNP web server port. |

## Variables

Every track change updates the following Lumia variables:

| Variable | Description |
| --- | --- |
| `{{whatsnowplaying_title}}` | Track title |
| `{{whatsnowplaying_artist}}` | Artist name |
| `{{whatsnowplaying_album}}` | Album name |
| `{{whatsnowplaying_albumartist}}` | Album artist |
| `{{whatsnowplaying_genre}}` | Genre |
| `{{whatsnowplaying_date}}` | Release date |
| `{{whatsnowplaying_bpm}}` | Tempo in BPM |
| `{{whatsnowplaying_key}}` | Musical key |
| `{{whatsnowplaying_label}}` | Record label |
| `{{whatsnowplaying_comments}}` | Track comments |
| `{{whatsnowplaying_duration}}` | Duration in `MM:SS` format |
| `{{whatsnowplaying_duration_hhmmss}}` | Duration in `HH:MM:SS` format |
| `{{whatsnowplaying_duration_sec}}` | Duration in whole seconds |
| `{{whatsnowplaying_isrc}}` | ISRC code |
| `{{whatsnowplaying_cover_palette}}` | Up to 6 dominant hex colors from the cover art, comma-separated (e.g. `#c85028,#3a7abf`) |
| `{{whatsnowplaying_cover_palette_lighting}}` | Up to 6 vibrant hex colors from the cover art, filtered for stage-usable saturation |
| `{{whatsnowplaying_cover_palette_type}}` | Dominant color quality of the cover art: `vibrant`, `desaturated`, or `monochrome` |
| `{{whatsnowplaying_coverurl}}` | Cover art URL (requires WNP web server) |
| `{{whatsnowplaying_filename}}` | Local file path |
| `{{whatsnowplaying_track}}` | Track number |
| `{{whatsnowplaying_track_total}}` | Total number of tracks on the album |
| `{{whatsnowplaying_composer}}` | Composer |
| `{{whatsnowplaying_deck}}` | DJ deck the track is playing on |
| `{{whatsnowplaying_requester}}` | Username who requested the track |
| `{{whatsnowplaying_requestdisplayname}}` | Display name of the requester |
| `{{whatsnowplaying_artistshortbio}}` | Short artist biography |

A **Track Changed** (`switchSong`) alert fires on every track change. Attach light commands,
overlays, or any other Lumia Stream automation to this alert and reference the variables above.

### Cover Art Colors

> **Requires What's Now Playing 5.3.0 or later.** These variables will be empty on earlier versions.

See the [WNP template variable reference](https://whatsnowplaying.github.io/whats-now-playing/latest/reference/templatevariables/#cover-art-colors)
for a full explanation of `cover_palette`, `cover_palette_lighting`, and `cover_palette_type`.

## Troubleshooting

* **Variables are empty** — Confirm the **Web Server** output is enabled in WNP and the port
  in the plugin settings matches WNP's web server port (default: `8899`).
* **No cover art** — `{{whatsnowplaying_coverurl}}` requires the WNP web server to be running.
* **Plugin not connecting** — If hostname is set to `auto`, WNP must be running on the same
  local network. Try setting the hostname to WNP's IP address directly.
* **"Plugin version too old"** — Download the latest release and reinstall.

## License

MIT
