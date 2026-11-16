# FSP Toolset Modern

[![Version](https://img.shields.io/badge/version-0.2.0-blue.svg)](https://github.com/edoardoD/fsp-toolset)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.93.0-007ACC.svg)](https://code.visualstudio.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](#-licenza-e-crediti)

**FSP Toolset Modern** è un ambiente integrato (IDE) per Visual Studio Code dedicato alla progettazione, verifica formale e simulazione di automi in linguaggio **FSP** (*Finite State Processes*) e sistemi di transizione a stati etichettati (**LTS** - *Labelled Transition Systems*).

Progettata con un approccio **Code-First con Live Preview**, garantisce massima pulizia, zero configurazione e feedback immediato:
- **Live Graph Preview** sincronizzata in tempo reale mentre scrivi codice FSP.
- **CodeLens inline** sopra ogni processo e composizione (`Visualizza Grafo | Simula | Safety & Deadlock | Progress`).
- **Simulatore / Animator Interattivo** per esplorare gli automi passo-passo direttamente sul grafo.
- **Evidenziazione visiva dei Controesempi** (tracce verso `DEADLOCK` o `ERROR`) direttamente sugli stati e sugli archi.
- **Pannello laterale FSP Studio** dedicato nella Activity Bar.
- **Esportazione Grafica** in **PNG ad alta risoluzione (2x)** e **SVG vettoriale**.

---

## ✨ Funzionalità Principali

- ⚡ **Live Preview in Tempo Reale**:
  - Modifica il codice `.lts` o `.fsp` a sinistra e osserva l'automa aggiornarsi automaticamente nel pannello laterale destro, mantenendo zoom e impostazioni di layout (attivabile/disattivabile tramite il pulsante `⚡ Live`).
- 🪄 **CodeLens & Go-to-Definition Inline**:
  - Pulsanti d'azione rapidi direttamente sopra ogni definizione di processo (`P = ...`), proprietà (`property SAFE = ...`) e composizione (`||SYS = ...`).
  - Supporto `Cmd+Click` / `F12` (*Go to Definition*) per saltare immediatamente alla definizione di qualsiasi processo, costante, range o set.
- 🎮 **Simulatore / Animator Passo-Passo Integrato**:
  - Avvia la modalità `🎮 Simula` per esplorare il comportamento dell'automa partendo dallo stato iniziale `0`.
  - Clicca direttamente sulle transizioni abilitate nel grafo oppure usa i pulsanti delle azioni nel cassetto inferiore del Simulatore.
  - Include cronologia completa del percorso (*breadcrumb*), conteggio passi, `⏪ Indietro (Step Back)`, `⏮ Reset` e rilevamento visivo immediato di stati `STOP` (Deadlock) o `ERROR`.
- 🛡️ **Verifica Formale (Safety, Deadlock & Progress) con Controesempi sul Grafo**:
  - Equivalente ai controlli *Check → Safety* e *Check → Progress* di LTSA.
  - In caso di violazione o deadlock, evidenzia in rosso il percorso esatto sul grafo numerando i passi (`[#1]`, `[#2]`, ...) e permette di riprodurre il controesempio nel Simulatore con un clic (`▶️ Simula Traccia`).
- 🧭 **Pannello Laterale FSP Studio (Activity Bar)**:
  - Vista ad albero dedicata che elenca **Composizioni (`||`)**, **Processi e Proprietà**, **Costanti, Range e Set**.
  - Mostra i badge con l'esito dell'ultima verifica (`✓ Safety OK` / `✗ Safety Violazione`) e pulsanti d'azione rapida su ogni elemento.
- 📊 **Visualizzatore Grafico Interattivo & Esportazione**:
  - Rendering client-side con **Cytoscape.js** + **Dagre** (zero dipendenze Graphviz).
  - **5 algoritmi di layout**: *Orizzontale (Left → Right)*, *Verticale (Top → Bottom)*, *Gerarchico ad Albero*, *Concentrico*, *Organico (Force-Directed)*.
  - **Esportazione Immagini**: salva il grafo in **PNG ad alta risoluzione** (`📷 PNG`) o **SVG vettoriale** (`📐 SVG`).

---

## 📋 Prerequisiti

- **Java Runtime Environment (JRE o JDK 8+)**: rilevato automaticamente tramite `find-java-home`.
- **Nessuna installazione di Graphviz richiesta**: il file `ltsa.jar` e i motori grafici sono già inclusi nell'estensione.

---

## 📦 Installazione

Da terminale o da VS Code (**Extensions: Install from VSIX...**):
```bash
code --install-extension fsp-toolset-modern-0.2.0.vsix
```

---

## 🧪 Suite di Test Automatici (LTSA + Playwright UI)

Il progetto include una suite completa di test automatizzati (Mocha + Playwright Headless Chromium) che verifica sia il backend formale LTSA sia la grafica renderizzata sul `<canvas>` HTML5 della Webview:

```bash
npm test
```

I test verificano automaticamente:
1. Compilazione FSP, rilevamento errori sintattici e verifica formale Safety/Deadlock/Progress tramite `FspBridge`.
2. Parsing strutturale dei simboli FSP (`composite`, `process`, `property`, `const`, `range`, `set`).
3. Rendering grafico su `<canvas>` Cytoscape.js, cambio dinamico di layout ed etichette stati.
4. Automazione passo-passo del **Simulatore / Animator** (`step`, `stepBack`, `reset`).
5. Evidenziazione visiva dei **controesempi** sul grafo e replay automatico della traccia.
6. Esportazione grafica in **PNG**, **SVG** e cattura di screenshot visuali tramite Playwright.

---

## ⌨️ Comandi Principali

| Comando | ID | Descrizione |
|---|---|---|
| `FSP: Visualizza Grafo Interattivo` | `fspModern.showGraph` | Apre FSP Studio con il grafo interattivo dell'automa. |
| `Simula Passo-Passo` | `fspModern.simulateTarget` | Apre il grafo e avvia subito il Simulatore interattivo sul target. |
| `FSP: Verifica Safety & Deadlock` | `fspModern.checkSafety` | Verifica proprietà di Safety e assenza di Deadlock evidenziando eventuali controesempi. |
| `FSP: Verifica Progress & Liveness` | `fspModern.checkProgress` | Verifica assenza di starvation/livelock. |
| `FSP: Compila File Corrente` | `fspModern.compile` | Esegue il controllo sintattico e aggiorna la diagnostica. |

---

## 📄 Licenza e Crediti

- Motore formale LTSA sviluppato da Jeff Kramer & Jeff Magee (Imperial College London).
- Estensione rilasciata sotto licenza MIT.
