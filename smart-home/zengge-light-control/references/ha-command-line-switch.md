# Home Assistant Integration

Add Slurp as a controllable switch in Home Assistant (HA). HA runs on the MacBook Air at 127.0.0.1:8123.

## command_line Switch (configuration.yaml)

```yaml
command_line:
  - switch:
      name: "Slurp LED"
      unique_id: slurp_led_bulb
      command_on: >
        python3 -c "
        import socket; s=socket.socket();
        s.settimeout(2);
        s.connect(('127.0.0.1',5577));
        s.send(bytes([0x71,0x23,0x0F,0xA3,0x00,0x00,0x00,0x00]));
        s.close()"
      command_off: >
        python3 -c "
        import socket; s=socket.socket();
        s.settimeout(2);
        s.connect(('127.0.0.1',5577));
        s.send(bytes([0x71,0x24,0x0F,0xA4,0x00,0x00,0x00,0x00]));
        s.close()"
      command_state: >
        python3 -c "
        import socket; s=socket.socket();
        s.settimeout(2);
        s.connect(('127.0.0.1',5577));
        s.send(bytes([0x81,0x8A,0x8B,0x96]));
        import time; time.sleep(0.1);
        r=s.recv(14);
        s.close();
        print('on' if r[2]==0x23 else 'off')"
```

After editing, validate with **Developer Tools → Check Configuration** then restart HA. Creates `switch.slurp_led` entity.

## Protocol Bytes Reference

- **ON**: `71 23 0F A3 00 00 00 00` (8 bytes)
- **OFF**: `71 24 0F A4 00 00 00 00` (8 bytes)
- **RGB color**: `31 R G B 00 F0 0F` (7 bytes, e.g. `31 FF 00 00 00 F0 0F` for red)
- **Status query**: `81 8A 8B 96` → response byte at index 2: `0x23` = ON, `0x24` = OFF

## Notes

- The bulb is at 127.0.0.1:5577 on the local network — reachable from any device on 127.0.0.0/24 including the HA MacBook Air
- `command_line` is a YAML-only integration — cannot be added via HA config flow API, must edit configuration.yaml directly
- For programmatic HA API access from Hermes, see `home-assistant` skill
