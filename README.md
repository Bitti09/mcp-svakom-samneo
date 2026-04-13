# Svakom Sam Neo MCP Server
![AI Assisted](https://img.shields.io/badge/AI-Assisted-blue?style=flat-square)

Fork of [Kyure-A/mcp-svakom-samneo](https://github.com/Kyure-A/mcp-svakom-samneo) updated for **Buttplug.io Spec v4**.

## Key Fork Highlights

*   **Buttplug.io v4 Feature-Map Implementation**: Migration from hardcoded actuator indices to the Spec v4 feature-map model. Uses dynamic runtime discovery for `Vibrate` and `Constrict` outputs across the Sam Neo product line.
*   **Asynchronous Tool Execution**: Internal event loop decoupling for stimulation tools. Commands are acknowledged via MCP immediately, with stimulation loops executing out-of-band to maintain server responsiveness.

## Other Improvements

*   **Hardware Actuator Caching**: Object-level caching of device features during bootstrap to eliminate per-command Map lookups and reduce CPU jitter during high-frequency loops.
*   **Process & Connection Safety**: Implementation of `stdin` end-of-stream listeners to trigger hardware `stopAll` and client disconnection handling if the parent process terminates.
*   **Strict Identity Verification**: Combined name-pattern matching and feature-set signature validation to enforce compatibility and reject other Svakom models (Alex, Vick, etc.).
*   **Intensity Safety Logic**: Arithmetic floor protection in pattern generation to prevent low-power stimulation steps from being rounded to zero at the hardware level.

---

---

## Device Support

Strict signature verification is performed at runtime.

### Original Sam Neo
*   **`Svakom-Sam-Neo-Piston`**: Synchronized dual-vibrator motion.
*   **`Svakom-Sam-Neo-ExtendedO`**: Dual-vibrate intensity reduction.
*   **`Svakom-Sam-Neo-DeviceInfo`**: Battery and hardware diagnostics.

### Sam Neo 2 / Sam Neo 2 Pro (v4)
*   **`Svakom-Sam-Neo-Piston`**: Single-vibrator patterns.
*   **`Svakom-Sam-Neo-Combo`**: Vibration and suction control (sync/independent).
*   **`Svakom-Sam-Neo-Vacuum`**: Physical suction engine patterns.
*   **`Svakom-Sam-Neo-ExtendedO`**: Actuator-specific intensity reduction.
*   **`Svakom-Sam-Neo-DeviceInfo`**: v4 Feature-map and battery reporting.

---

## Available Tools

### `Svakom-Sam-Neo-Piston`
Vibration-based motion simulation.
- **Parameters**: 
  - `duration`: Total time in milliseconds (1000-100000).
  - `steps`: Resolution of the motion pattern (20-1000).
  - `vibrationPower`: Peak intensity (0.0-1.0).

### `Svakom-Sam-Neo-Vacuum`
Direct suction control (Sam Neo 2 / Pro only).
- **Parameters**: 
  - `intensity`: Suction power (0.0-1.0).
  - `duration`: Total time in milliseconds (100-30000).
  - `pattern`: `constant`, `pulse`, or `wave`.
  - `pulseInterval`: Interval for pulse pattern in ms (optional).

### `Svakom-Sam-Neo-Combo`
Synchronized vibration and suction control.
- **Parameters**: 
  - `duration`: Total time in milliseconds.
  - `steps`: Resolution of the motion pattern.
  - `vibrationPower`: Vibration intensity (0.0-1.0).
  - `vacuumIntensity`: Suction intensity (0.0-1.0).
  - `syncMode`: `synchronized`, `alternating`, or `independent`.
  - `vacuumPattern`: Pattern for suction (`constant`, `pulse`, or `wave`).

### `Svakom-Sam-Neo-ExtendedO`
Technical climax control (prolongs climax by dropping intensity).
- **Parameters**: 
  - `currentVibration`: Intensity to reduce from.
  - `currentVacuum`: Suction power to reduce from.
  - `holdDuration`: Time to hold at minimum intensity (ms).
  - `restoreDuration`: Time to return to original power (ms).
  - `minimumLevel`: Intensity during the hold phase (default 0.1).

### `Svakom-Sam-Neo-DeviceInfo`
Reports connection status, current intensity states, and the discovered Spec v4 hardware feature-map.

---

## Safety & Configuration

### Hard Mode (Unrestricted Stimulation)
The server includes an optional **Hard Mode** for advanced users who want unrestricted stimulation. When enabled:
- **Anti-Jolt Disabled**: The 70% intensity jump limit is lifted, allowing immediate spikes from 0% to 100%.
- **Hidden Warnings**: AI-facing tool descriptions omit the safety instructions to use ramps, presenting the device as fully unrestricted.

To enable, set the environment variable in your MCP configuration:
```json
"env": {
  "SAM_NEO_HARD_MODE": "true"
}
```

---

## Installation & Setup

Requires **pnpm** and Node.js v25+.

1.  **Dependencies**:
    ```bash
    pnpm install
    ```
2.  **Build**:
    ```bash
    pnpm run build
    ```
3.  **Verify**:
    ```bash
    pnpm test
    ```
4.  **MCP Configuration**:
    ```json
    "mcp-svakom-samneo": {
      "command": "node",
      "args": ["/absolute/path/to/build/index.js"],
      "env": {
        "BUTTPLUG_WS_URL": "ws://localhost:12346"
      }
    }
    ```

---

## Technical Verification

Automated test suite (Vitest):
*   **Identity Protection**: Validates hardware signatures for Sam Neo Original and Pro.
*   **Collision Testing**: Verifies secure rejection of non-Sam Svakom devices (e.g., Alex Neo, Vick Neo 2).

---

## Credits
- **Original Project**: [Kyure-A/mcp-svakom-samneo](https://github.com/Kyure-A/mcp-svakom-samneo)
- **Implementation Note**: Logic refactoring and Spec v4 migration assisted by Gemini.
- **Protocol**: [Buttplug.io](https://buttplug.io)
- **Engine**: [Model Context Protocol](https://modelcontextprotocol.io)
