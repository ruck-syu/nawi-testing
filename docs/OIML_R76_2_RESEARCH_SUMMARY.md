# OIML R 76-2:20xx (Edition 202x / 1.1CD) Deep Technical Research
## Non-Automatic Weighing Instruments — Part 2: Test Procedures

### 1. Document Architecture & Scope
OIML R 76-2 defines the definitive international test procedures and evaluation protocols for pattern approval / type examination of Non-Automatic Weighing Instruments (NAWI). It operates under the 5-part structure:
- **Part 1 (R 76-1):** Metrological & Technical Requirements
- **Part 2 (R 76-2):** Test Procedures (this document)
- **Part 3 (R 76-3):** Test Report Format
- **Part 4 (R 76-4):** Type Evaluation Report Format
- **Part 5 (R 76-5):** Verification & In-service Inspection

---

### 2. Core Metrological Formulas & Evaluation Mechanics

#### 2.1 Indication & Error Prior to Rounding (Changeover Point Method)
When resolution is not $\le \frac{1}{5}e$, the changeover point method is mandatory using small weights ($\Delta L = \frac{1}{10}e$):
$$\text{True Indication } P = I + \frac{1}{2}e - \Delta L$$
$$\text{Error } E = P - L = I + \frac{1}{2}e - \Delta L - L$$
$$\text{Corrected Error } E_c = E - E_0$$
*where $E_0$ is the zero-load error calculated at zero (or $\approx 10e$ when zero-tracking is active).*

#### 2.2 Maximum Permissible Error (MPE) Step Bands
For initial verification / type approval:
| Accuracy Class | Verification Scale Interval ($e$) | $\pm 0.5e$ MPE Band | $\pm 1.0e$ MPE Band | $\pm 1.5e$ MPE Band |
| :--- | :--- | :--- | :--- | :--- |
| **Class I** ($\text{Special}$) | $0.001\text{ g} \le e$ | $0 \le m \le 50\,000e$ | $50\,000e < m \le 200\,000e$ | $m > 200\,000e$ |
| **Class II** ($\text{High}$) | $0.001\text{ g} \le e \le 0.05\text{ g}$<br>$0.1\text{ g} \le e$ | $0 \le m \le 5\,000e$ | $5\,000e < m \le 20\,000e$ | $m > 20\,000e$ |
| **Class III** ($\text{Medium}$) | $0.1\text{ g} \le e \le 2\text{ g}$<br>$5\text{ g} \le e$ | $0 \le m \le 500e$ | $500e < m \le 2\,000e$ | $m > 2\,000e$ |
| **Class IIII** ($\text{Ordinary}$) | $5\text{ g} \le e$ | $0 \le m \le 50e$ | $50e < m \le 200e$ | $m > 200e$ |

#### 2.3 Modular Error Allocation Factor ($p_i$)
When testing separate modules:
$$\text{mpe}_{module} = p_i \times \text{mpe}_{total}$$
$$\sum p_i^2 = p_{con}^2 + p_{ind}^2 + p_{LC}^2 \le 1.0$$
- Indicator / Analogue processing: $p_i \in [0.3, 0.8]$ (default $0.5$)
- Load cells (R 60): $p_{LC} = 0.7$ (default)
- Digital data processing / Displays: $p_i = 0.0$
- Complete weighing module: $p_i = 1.0$

---

### 3. Comprehensive Data Dictionary: Data Types, Units & Ranges

#### 3.1 Global Environmental & Ambient Parameters (Per Test Run)

| Parameter | Data Type | Physical Unit | Operational Range / Constraints | Test Notes / Tolerances |
| :--- | :---: | :---: | :--- | :--- |
| **Ambient Temperature** | `Float` | $^\circ\text{C}$ | $-10^\circ\text{C}$ to $+40^\circ\text{C}$ *(or specified range)* | Steady if $\Delta T \le \frac{1}{5}\text{range}$ and $\le 5^\circ\text{C}$ ($\le 2^\circ\text{C}$ for creep). Rate $\le 5^\circ\text{C}/\text{h}$. |
| **Chamber Temperature** | `Float` | $^\circ\text{C}$ | $-20^\circ\text{C}$ to $+60^\circ\text{C}$ | Controlled thermal chamber during static temperature sequence. |
| **Relative Humidity** | `Float` | $\%$ | $20\%$ to $95\%$ RH | High temp: absolute humidity $\le 20\text{ g/m}^3$ ($39\%$ RH at $40^\circ\text{C}$). Damp heat: $85\%$ RH. |
| **Barometric Pressure** | `Float` | $\text{hPa} / \text{mbar}$ | $860$ to $1060\text{ hPa}$ | Normal atmospheric pressure (standard ref: $1013.25\text{ hPa}$). Mandatory for Class I. |
| **Timestamp / Date** | `ISO String` | `YYYY-MM-DD HH:MM` | Real datetime | Date and time when each test leg is recorded. |
| **Operator** | `String` | text | $\le 120$ chars | Responsible technician / examiner name. |

---

#### 3.2 Performance Tests (Clause 5)

| Test & Clause | Parameter / Field | Data Type | Unit | Range / Constraints | Pass / Fail Tolerance |
| :--- | :--- | :---: | :---: | :--- | :--- |
| **Weighing Performance**<br>*(5.4, 6.3.1, 8.2)* | `loadValue` ($L$)<br>`indicationUp` ($I_\uparrow$)<br>`indicationDown` ($I_\downarrow$)<br>`deltaL` ($\Delta L$)<br>`nI` ($n_i = L/e$)<br>`errorUp` ($E_\uparrow$)<br>`errorDown` ($E_\downarrow$)<br>`correctedError` ($E_c$) | `Float`<br>`Float`<br>`Float`<br>`Float`<br>`Integer`<br>`Float`<br>`Float`<br>`Float` | $\text{g} / \text{kg}$<br>$\text{g} / \text{kg}$<br>$\text{g} / \text{kg}$<br>$\text{g} / \text{kg}$<br>count<br>$\text{g} / \text{kg}$<br>$\text{g} / \text{kg}$<br>$\text{g} / \text{kg}$ | $\text{Min} \le L \le \text{Max}$<br>$\ge 10$ steps ascending & descending<br>$\Delta L \in [0, 1.0e]$ in $0.1e$ steps<br>$n_i \in [0, n_{max}]$ | Corrected error:<br>$\|E_c\| = \|(I + 0.5e - \Delta L - L) - E_0\| \le \text{mpe}$<br>$\pm 0.5e$ ($0 \le m \le 5\,000e$)<br>$\pm 1.0e$ ($5\,000e < m \le 20\,000e$)<br>$\pm 1.5e$ ($m > 20\,000e$) |
| **Zero-Setting**<br>*(5.2)* | `initialZeroRange`<br>`zeroError` ($E_0$) | `Float (+/-)`<br>`Float` | $\%$ of $\text{Max}$<br>$\text{g} / \text{kg}$ | Non-auto/semi-auto: $\le 4\%\text{Max}$<br>Auto-zero: $\le 4\%\text{Max}$ | Zero accuracy: $\|E_0\| \le 0.25e$<br>Supplementary test if $\text{IZSR} > 20\%\text{Max}$. |
| **Tare**<br>*(5.6)* | `tareValue`<br>`netLoad`<br>`tareError` | `Float`<br>`Float`<br>`Float` | $\text{g} / \text{kg}$<br>$\text{g} / \text{kg}$<br>$\text{g} / \text{kg}$ | Subtractive: $1/3$ to $2/3\text{Max}_{tare}$<br>Additive: $1/3$ and $3/3\text{Max}_{tare}$<br>$\ge 5$ net load steps | Tare setting error $\le 0.25e$<br>Net weighing errors $\le \text{mpe}$. |
| **Eccentricity**<br>*(5.7)* | `positionCode`<br>`eccentricLoad`<br>`indication`<br>`correctedError` | `String / (x,y)`<br>`Float`<br>`Float`<br>`Float` | enum / mm<br>$\text{g} / \text{kg}$<br>$\text{g} / \text{kg}$<br>$\text{g} / \text{kg}$ | 4 quadrants ($\le 4$ supports)<br>Load: $\frac{1}{3}(\text{Max} + \text{Max Tare})$ ($\le 4$ pt)<br>$\frac{1}{N-1}(\text{Max} + \text{Max Tare})$ ($>4$ pt)<br>$0.8\text{Max}$ (rolling loads) | At each position:<br>$\|E_c\| = \|E - E_0\| \le \text{mpe}$. |
| **Repeatability**<br>*(5.10)* | `seriesLoad`<br>`sequenceNo`<br>`indication` ($I$)<br>`range` ($P_{max}-P_{min}$) | `Float`<br>`Integer`<br>`Float`<br>`Float` | $\text{g} / \text{kg}$<br>$1 \dots 10$<br>$\text{g} / \text{kg}$<br>$\text{g} / \text{kg}$ | Series 1: $50\%\text{Max}$<br>Series 2: $100\%\text{Max}$<br>10 cycles ($\text{Max} < 1000\text{kg}$)<br>3 cycles ($\text{Max} \ge 1000\text{kg}$) | Reading spread $(P_{max} - P_{min}) \le \text{mpe}(L)$<br>*(single overall pass/fail verdict)*. |
| **Creep & Zero Return**<br>*(5.11)* | `creepLoad`<br>`readingTime`<br>`indication`<br>`creepDrift`<br>`zeroReturnError` | `Float`<br>`Integer`<br>`Float`<br>`Float`<br>`Float` | $\text{g} / \text{kg}$<br>minutes<br>$\text{g} / \text{kg}$<br>$\text{g} / \text{kg}$<br>$\text{g} / \text{kg}$ | Load: $\approx \text{Max}$<br>Time: $0, 15, 30\text{ min}, 1, 2, 3, 4\text{ h}$<br>Zero return: after $30\text{ min}$ loading | Creep over 4h: $\le 0.5e$<br>*(Fast abort allowed if $<0.5e$ in 30m & $<0.2e$ in 15–30m)*<br>Zero return residual: $\le 0.5e$. |
| **Discrimination**<br>*(5.8)* | `testLoad`<br>`extraLoad`<br>`initialIndication`<br>`switchedIndication` | `Float`<br>`Float`<br>`Float`<br>`Float` | $\text{g} / \text{kg}$<br>$\text{g} / \text{kg}$<br>$\text{g} / \text{kg}$<br>$\text{g} / \text{kg}$ | Test loads: $\text{Min}, 0.5\text{Max}, \text{Max}$<br>Digital $d \ge 5\text{mg}$: extra load $= 1.4d$ added to $I - d + 0.1d$ | Indication must switch unambiguously from $I-d$ to $I+d$. |
| **Stability of Equilibrium**<br>*(5.12)* | `disturbedLoad`<br>`postPrintDuration`<br>`observedValues` | `Float`<br>`Float`<br>`Float[]` | $\text{g} / \text{kg}$<br>seconds<br>array | Load: $0.5\text{Max}$<br>Duration: $5.0\text{ s}$ post-print | No more than 2 adjacent division values allowed (one being printed value). |

---

#### 3.3 Influence Factors & Environmental Tests (Clause 6)

| Test & Clause | Parameter | Data Type | Unit | Range / Constraints | Tolerance |
| :--- | :--- | :---: | :---: | :--- | :--- |
| **Tilting** *(6.1)* | `tiltAngle`<br>`load`<br>`error` | `Float`<br>`Float`<br>`Float` | $\text{mrad} / \text{mm/m}$<br>$\text{g} / \text{kg}$<br>$\text{g} / \text{kg}$ | Limiting tilt angle ($50/1000$ or level indicator ring limit)<br>Loads: $10e$ and $0.5 - 1.0\text{Max}$ | $\|E_c\| \le \text{mpe}$ or display must blank / inhibit print. |
| **Warm-up Time** *(6.2)* | `disconnectedHours`<br>`checkIntervals`<br>`error` | `Float`<br>`Integer`<br>`Float` | hours<br>minutes<br>$\text{g} / \text{kg}$ | Disconnected $\ge 8\text{ h}$<br>Checked at $5, 15, 30\text{ min}$ under $\approx \text{Max}$ | Zero-corrected error $\|E_c\| \le \text{mpe}$. |
| **Static Temperature** *(6.3.1)* | `temperature`<br>`rateOfChange`<br>`soakTime`<br>`error` | `Float`<br>`Float`<br>`Float`<br>`Float` | $^\circ\text{C}$<br>$^\circ\text{C}/\text{min}$<br>hours<br>$\text{g} / \text{kg}$ | Sequence: $20^\circ\text{C} \rightarrow 40^\circ\text{C} \rightarrow -10^\circ\text{C} \rightarrow 5^\circ\text{C} \rightarrow 20^\circ\text{C}$<br>Rate $\le 1^\circ\text{C}/\text{min}$; Soak $\ge 2\text{ h}$ | All loading/unloading steps within $\text{mpe}$. |
| **No-Load Temp Drift** *(6.3.2)* | `zeroDrift` | `Float` | $\text{g} / ^\circ\text{C}$ | Consecutive temp legs | Class I: $\le 1e / 1^\circ\text{C}$<br>Classes II, III, IIII: $\le 1e / 5^\circ\text{C}$. |
| **Voltage Variations** *(6.4)* | `mainsVoltageRatio`<br>`dcVoltage`<br>`batteryVoltage`<br>`error` | `Float`<br>`Float`<br>`Float`<br>`Float` | $\%$ of $U_{nom}$<br>$\text{V}$<br>$\text{V}$<br>$\text{g} / \text{kg}$ | AC: $85\% - 110\% U_{nom}$<br>Ext DC: $U_{min} - 120\% U_{max}$<br>Vehicle: $U_{min} - 16\text{V}$ (12V) / $U_{min} - 32\text{V}$ (24V) | Tested at $10e$ and $0.5 - 1.0\text{Max}$.<br>$\|E_c\| \le \text{mpe}$. |

---

#### 3.4 Disturbances & EMC Tests (Clause 8)

| Test & Clause | Disturbance Parameter | Data Type | Physical Range / Level | Significant Fault Criterion |
| :--- | :--- | :---: | :--- | :--- |
| **Damp Heat Steady State** *(8.2)* | `exposureHours`, `temp`, `humidity` | `Float` | $48\text{ h}$, Upper temp limit ($40^\circ\text{C}$), $85\%$ RH | $\|E_c\| \le \text{mpe}$. |
| **Voltage Dips & Interruptions** *(8.3.1)* | `reductionPct`, `durationCycles` | `Float`, `Integer` | Reductions to $0\%, 40\%, 70\%, 80\%$ for $0.5$ to $50$ cycles | $|\Delta I| \le 1.0e$ OR instrument detects fault & inhibits weighing. |
| **Fast Transient Bursts (EFT)** *(8.3.2)* | `burstPeakVoltage`, `repetitionRate` | `Float`, `kHz` | Power: $1.0\text{ kV}$, I/O: $0.5\text{ kV}$ ($5/50\text{ ns}, 5\text{ kHz}$) | $|\Delta I| \le 1.0e$ OR significant fault. |
| **Surge Immunity** *(8.3.3)* | `surgePeakVoltage` | `Float` | Line-Line: $0.5\text{ kV}$, Line-Earth: $1.0\text{ kV}$ | $|\Delta I| \le 1.0e$ OR significant fault. |
| **Electrostatic Discharge (ESD)** *(8.3.4)* | `esdVoltage`, `pulseCount` | `Float`, `Integer` | Contact: $6\text{ kV}$, Air: $8\text{ kV}$ ($\ge 10$ pulses, $\ge 10\text{s}$ interval) | $|\Delta I| \le 1.0e$ OR significant fault. |
| **Radiated RF Immunity** *(8.3.5)* | `frequencyRange`, `fieldStrength` | `Float`, `Float` | $80 - 2000\text{ MHz}$, $10\text{ V/m}$, $80\%\text{ AM } (1\text{ kHz})$ | $|\Delta I| \le 1.0e$ OR significant fault. |
| **Conducted RF Immunity** *(8.3.6)* | `frequencyRange`, `rfAmplitude` | `Float`, `Float` | $0.15 - 80\text{ MHz}$, $10\text{ V (emf)}$, $80\%\text{ AM } (1\text{ kHz})$ | $|\Delta I| \le 1.0e$ OR significant fault. |
| **Span Stability** *(8.4)* | `measurementIndex`, `elapsedDays`, `spanDrift` | `Integer`, `Integer`, `Float` | 8 measurements over $\ge 28\text{ days}$ | Maximum drift $\text{mpd} = \max(0.5e, 0.5\text{mpe})$. Trend warning if $>0.5\text{mpd}$. |

---

#### 3.5 Modular Compatibility Quantities (Clause 12)

| Quantity Symbol | Description | Data Type | Physical Unit | Mathematical Formula / Constraint |
| :--- | :--- | :---: | :---: | :--- |
| $p_i$ | Fraction of MPE | `Float` | dimensionless | $p_{con}^2 + p_{ind}^2 + p_{LC}^2 \le 1.0$ ($0.3 \le p_{ind} \le 0.8$) |
| $n_{ind}, n_{LC}$ | Verification intervals | `Integer` | count | $n_{ind} \ge n$, $n_{LC} \ge n$ |
| $Q$ | Overload/capacity factor | `Float` | dimensionless | $Q = \frac{\text{Max} + DL + IZSR + NUD + T^+}{\text{Max}} \le \frac{E_{max} \cdot N}{\text{Max} \cdot R}$ |
| $v_{min}$ | Min verification interval | `Float` | $\text{g} / \text{kg}$ | $v_{min} \le e_1 \times \frac{R}{\sqrt{N}}$ |
| $\Delta u$ | Signal per scale interval | `Float` | $\mu\text{V} / e$ | $\Delta u = \frac{C \times U_{exc} \times R \times e_1}{E_{max} \times N} \ge \Delta u_{min}$ |
| $R_{LC} / N$ | Total load cell impedance | `Float` | $\Omega$ | $R_{LC} / N \in [R_{Lmin}, R_{Lmax}]$ |
| $(L/A)$ | Cable wire ratio | `Float` | $\text{m} / \text{mm}^2$ | $(L/A) \le (L/A)_{max}$ (6-wire remote sense mandatory if extended) |

---

#### 3.6 Software Requirements & Testing (Clause 13)
- **AD (Analysis of Documentation):** System architecture, separation of legal vs non-legal software, cryptographic sealing.
- **VFTSw (Verification by Functional Testing of Software):** Checksum/hash validation, audit trail non-erasability, event counter incrementation, protective interfaces preventing buffer overflows or parameter corruption.
