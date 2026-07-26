---
name: zengge-light-control
description: "Control Zengge LED bulb (Slurp) on local network via Pi Zero — on/off/color over TCP port 5577."
version: 1.0.0
metadata:
  hermes:
    tags: [smart-home, lights, zengge, led]
---

# Zengge Light Control

Control smart bulbs using Zengge protocol (TCP port 5577) via Pi Zero on local network.

## Supported Lights

| Name | Type |
|------|------|
| slurp | Zengge smart bulb |

IPs stored in `lights.yaml` on Pi (gitignored).

## Commands

```
ssh ksn@ksn-pi "python3 ~/pi-zero/lights/light-control.py <light> <command> [args]"
```

Commands: `on`, `off`, `red`, `green`, `blue`, `white`, `warm`, `cool`, `pink`, `purple`, `orange`, `yellow`, `cyan`, `color R G B`, `warm N`

Examples:
```
# Turn Slurp red
ssh ksn@ksn-pi "python3 ~/pi-zero/lights/light-control.py slurp red"

# Turn off
ssh ksn@ksn-pi "python3 ~/pi-zero/lights/light-control.py slurp off"

# Custom color
ssh ksn@ksn-pi "python3 ~/pi-zero/lights/light-control.py slurp color 255 128 0"
```

## Protocol

- TCP port 5577
- ON: `71 23 0F A3 00 00 00 00` (8 bytes)
- OFF: `71 24 0F A4 00 00 00 00` (8 bytes)
- RGB: `31 R G B 00 F0 0F` (7 bytes)
- No encryption. Device responds with status packet.

## Home Assistant Integration

To control Slurp from Home Assistant as a switch, see `references/ha-command-line-switch.md` for the exact `command_line` YAML config. Creates a `switch.slurp_led` entity controllable from the HA dashboard or API.

## Pitfalls

- SSH key required on Pi for `ksn` user
- Pi must be on Tailscale
- Don't run heavy installs on Pi — Pi-hole is critical for home WiFi
- Tuya-based bulbs need localKey from Smart Life account — not controllable yet
