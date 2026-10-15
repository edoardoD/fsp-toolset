# FSP Toolset Modern

[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](https://github.com)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.93.0-007ACC.svg)](https://code.visualstudio.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](#-licenza-e-crediti)

**FSP Toolset Modern** è l'estensione moderna per Visual Studio Code dedicata al linguaggio formale **FSP** (*Finite State Processes* / *Flexible Software Process*) e alla modellazione e verifica di sistemi di transizione a stati etichettati (**LTS** - *Labelled Transition Systems*).

Progettata per garantire **massima stabilità, semplicità d'uso e configurazione zero**, porta nel tuo editor preferito:
- Evidenziazione sintattica avanzata.
- Compilazione e diagnostica inline con il motore ufficiale LTSA dell'Imperial College.
- **Verifica formale di Safety, Deadlock e Progress** con controesempi (tracce).
- Visualizzazione grafica interattiva degli automi con layout intelligenti, senza dipendenze esterne come Graphviz.

---

## ✨ Funzionalità Principali

- 🎨 **Syntax Highlighting Avanzato**: supporto completo per file `.lts` e `.fsp` (processi, costanti, range, azioni, operatori di composizione concorrente `||`, prefissi `->`, scelte `|`, relabelling, insiemi e commenti).
- ⚡ **Compilazione & Diagnostica Inline**: esegue il parser e l'analizzatore formale LTSA segnalando istantaneamente gli errori di sintassi sia inline nell'editor che nel pannello **Problems** di VS Code.
- 🛡️ **Verifica Formale Integrata (Safety & Deadlock)**:
  - Equivalente al menu *Check → Safety* di LTSA.
  - Rileva deadlock e violazioni di proprietà `property` o stati `ERROR`.
  - Mostra la sequenza esatta di azioni (traccia / counterexample) che conduce alla violazione.
- 🔄 **Controllo di Liveness & Progress**:
  - Equivalente al menu *Check → Progress* di LTSA.
  - Verifica l'assenza di starvation e livelock con individuazione degli insiemi terminali.
- 🎯 **Target Picker Intelligente**:
  - Permette di scegliere esattamente quale processo singolo o composizione (`||`) analizzare o visualizzare.
  - Compila solo il componente richiesto, evitando esplosioni dello spazio degli stati su modelli complessi (es. *Space Invaders*).
  - Ricorda l'ultimo target selezionato per ciascun file.
- 📊 **Visualizzatore Grafico Interattivo (Webview)**:
  - **Zero Graphviz Dependency**: rendering puramente client-side basato su **Cytoscape.js** + **Dagre**.
  - **Palette Tematica Dinamica**: colori calcolati in tempo reale sul tema di VS Code (Dark, Light, High Contrast), senza bande nere o artefatti di rendering.
  - **Semantica Visiva degli Stati**:
    - 🟢 **Stato Iniziale (0)**: rettangolo arrotondato verde.
    - ⚪ **Stati Normali**: cerchi con identificativo di stato.
    - 🔘 **Stati Deadlock / STOP**: ottagoni grigi chiaramente contrassegnati.
    - 🔴 **Stati ERROR**: rombi rossi evidenziati.
  - **Layout Switcher Multiplo**:
    - *Orizzontale (Left → Right)*: layout gerarchico Dagre ottimale per automi.
    - *Verticale (Top → Bottom)*: gerarchico standard.
    - *Gerarchico ad Albero (Breadthfirst)*.
    - *Concentrico (Concentric)* centrato sullo stato iniziale.
    - *Organico (CoSE / Force-Directed)*.
  - **Controlli di Navigazione**: pulsante di centratura (🎯 *Centra*), pulsanti di Zoom In/Out e supporto completo per pan e drag-and-drop dei singoli nodi.
- 🚀 **Zero-Config Reale**: il file `ltsa.jar` è pre-incluso direttamente all'interno dell'estensione; non richiede connessione internet o download al primo avvio.

---

## 📋 Prerequisiti

- **Java Runtime Environment (JRE o JDK 8+)**: è sufficiente una qualsiasi installazione Java presente sul sistema (es. [Adoptium Eclipse Temurin](https://adoptium.net/), OpenJDK, Oracle JDK). L'estensione rileva automaticamente la JVM tramite `find-java-home`.
- **Nessuna installazione di Graphviz/dot richiesta** (funziona nativamente su macOS Apple Silicon/Intel, Windows e Linux).

---

## 📦 Installazione

Se hai a disposizione il pacchetto compilato `.vsix`:

1. Apri la Command Palette (`Cmd+Shift+P` su macOS o `Ctrl+Shift+P` su Windows/Linux).
2. Digita e seleziona **Extensions: Install from VSIX...**.
3. Seleziona il file `fsp-toolset-modern-0.1.0.vsix`.

Oppure installa via terminale:
```bash
code --install-extension fsp-toolset-modern-0.1.0.vsix
```

---

## 🎯 Guida all'Uso

### 1. File di Esempio FSP

Crea un file con estensione `.lts` o `.fsp` (ad esempio `mutex.lts`):

```fsp
// Esempio Mutua Esclusione con Lock
LOCK = (acquire -> release -> LOCK).

USER = (acquire -> release -> USER).

property SAFE = (acquire -> release -> SAFE).

// Composizione concorrente corretta
||SYS = (USER || LOCK || SAFE).

// Esempio con deadlock
DL = (a -> b -> STOP).
```

### 2. Compilazione e Verifica Sintattica

- Premi `Cmd+Shift+P` (o `Ctrl+Shift+P`) ed esegui:
  ```
  FSP: Compile Current File
  ```
- L'estensione analizza il file, popola i diagnostici inline/pannello **Problems** e notifica il numero di processi e composizioni individuati.

### 3. Verifica Formale (Safety, Deadlock e Progress)

- **Controllo Safety & Deadlock**:
  - Esegui `FSP: Check Safety and Deadlock`.
  - Seleziona il processo o la composizione da verificare dal menu rapido (es. `SYS` o `DL`).
  - L'esito viene mostrato tramite notifica e dettagliato nel canale di output **FSP**, inclusa la traccia completa in caso di violazione:
    ```
    === Safety / deadlock check: DL (mutex.lts) ===
    Composition:
    FSPTARGET = DL
    State Space:
     3 = 2 ** 2
    Composing...
      potential DEADLOCK
    Trace to DEADLOCK:
      a
      b
    ```
- **Controllo Progress**:
  - Esegui `FSP: Check Progress` per verificare l'assenza di violazioni di liveness/starvation.

### 4. Visualizzazione Grafica dell'Automa a Stati

- Clicca sull'icona **Grafo** in alto a destra nell'editor oppure esegui:
  ```
  FSP: Display Graph Visualisation
  ```
- Scegli il processo o la composizione dal QuickPick: si aprirà la Webview laterale interattiva.
- Usa la barra degli strumenti per:
  - Cambiare processo al volo dal menu a tendina **Process**.
  - Cambiare orientamento e algoritmo dal menu **Layout** (*Orizzontale*, *Verticale*, *Albero*, *Concentrico*, *Organico*).
  - Usare **🎯 Centra** o **+ / −** per regolare l'inquadratura.

---

## ⌨️ Comandi Disponibili

| Comando | ID | Descrizione |
|---|---|---|
| `FSP: Compile Current File` | `fspModern.compile` | Esegue il controllo sintattico e registra processi/composizioni. |
| `FSP: Display Graph Visualisation` | `fspModern.showGraph` | Apre la Webview con l'automa a stati interattivo del target selezionato. |
| `FSP: Check Safety and Deadlock` | `fspModern.checkSafety` | Verifica assenza di violazioni `property`, `ERROR` e deadlock (con traccia). |
| `FSP: Check Progress` | `fspModern.checkProgress` | Verifica proprietà di progresso e insiemi terminali (con traccia). |

---

## ⚙️ Impostazioni dell'Estensione

L'estensione include già il runtime LTSA e non richiede configurazione. È comunque possibile personalizzare il percorso di `ltsa.jar` se si desidera utilizzarne una versione modificata:

| Impostazione | Tipo | Default | Descrizione |
|---|---|---|---|
| `fspModern.ltsaJarPath` | `string` | `""` | *(Opzionale)* Percorso assoluto a un file `ltsa.jar` personalizzato. Se vuoto, viene utilizzato quello pre-incluso nell'estensione. |

---

## 🛠️ Risoluzione Problemi (FAQ)

<details>
<summary><b>1. "Java Runtime not found" all'avvio</b></summary>
Assicurati che Java (JRE o JDK versione 8 o superiore) sia installato e accessibile. Puoi scaricare una JRE open-source gratuita da <a href="https://adoptium.net/">Adoptium Temurin</a>.
</details>

<details>
<summary><b>2. Come analizzare un singolo processo senza comporre tutto il file?</b></summary>
Quando lanci <code>FSP: Display Graph Visualisation</code> o <code>FSP: Check Safety and Deadlock</code>, l'estensione mostra un selettore (QuickPick) con tutti i processi singoli e le composizioni <code>||</code>. Seleziona il processo desiderato: l'estensione isolerà solo quel componente senza comporre l'intero sistema.
</details>

<details>
<summary><b>3. Funziona senza una cartella workspace aperta?</b></summary>
Sì! Puoi aprire e verificare singoli file <code>.lts</code> o <code>.fsp</code> anche isolati: l'estensione utilizza file temporanei sicuri memorizzati nel global storage di VS Code.
</details>

---

## 📄 Licenza e Crediti

- Motore formale LTSA sviluppato da Jeff Kramer & Jeff Magee (Imperial College London).
- Estensione rilasciata sotto licenza MIT.
