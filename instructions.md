# FSP Toolset Modern - Guida e Documentazione

Questa estensione moderna per Visual Studio Code fornisce supporto completo per il linguaggio di modellazione formale **FSP (Flexible Software Process / Labelled Transition Systems)** con sintassi evidenziata, compilazione headless e visualizzazione interattiva dei grafi degli automi senza dipendenze Graphviz locali.

---

## 📁 Struttura del Progetto

```
fsp-toolset-modern/
├── .vscode/                   # Configurazioni di avvio e task per VS Code
│   ├── launch.json           # Configurazione F5 (Run Extension)
│   └── tasks.json            # Task di compilazione per esbuild
├── dist/                      # Bundle di runtime generato da esbuild
│   ├── extension.js          # Codice estensione compilato
│   ├── FspBridge.class       # Bridge headless Java precompilato (Java 8 bytecode)
│   └── FspBridge$*.class     # Classi interne del bridge Java
├── examples/                  # File di esempio FSP
│   └── sample.lts            # Esempio Produttore-Buffer-Consumatore
├── media/                     # Asset per la Webview grafica
│   ├── cytoscape.min.js      # Cytoscape core
│   ├── cytoscape-dagre.js    # Layout Dagre per Cytoscape
│   ├── dagre.min.js          # Libreria Dagre gerarchica
│   ├── graph.css             # Stili tema VS Code per il canvas
│   └── graph.js              # Controller client per zoom, pan e rendering
├── src/
│   ├── extension.ts          # Entry point dell'estensione VS Code
│   ├── diagnostics.ts        # Mappatura errori su DiagnosticCollection (Problems)
│   ├── java/
│   │   ├── javaLocator.ts    # Rilevamento automatico JVM di sistema via find-java-home
│   │   └── FspBridge.java    # Bridge Java per estrarre automi e diagnostica da ltsa.jar
│   ├── ltsa/
│   │   ├── ltsaProvider.ts   # Download automatico ltsa.jar e caching in globalStorage
│   │   └── ltsaRunner.ts     # Esecutore child_process sicuro e parser JSON
│   ├── webview/
│   │   └── graphPanel.ts     # Gestore WebviewPanel (CSP, nonce, postMessage)
│   └── test/                 # Test di unità
│       ├── runner.test.ts    # Test del bridge Java e compilazione
│       └── syntax.test.ts    # Test di validità TextMate e configurazione lingua
├── syntaxes/
│   └── fsp.tmLanguage.json   # Grammatica TextMate per file .lts e .fsp
├── language-configuration.json # Commenti, parentesi e auto-chiusure
├── package.json               # Manifest dell'estensione, comandi e dipendenze
├── tsconfig.json              # Configurazione TypeScript
└── instructions.md            # Questa guida
```

---

## 🚀 Come Testare e Utilizzare l'Estensione

### Metodo 1: Avvio Immediato in Modalità Sviluppo (F5) - Consigliato

1. **Apri la cartella del progetto in VS Code**:
   ```bash
   code /Users/edoardo/development_prdj/fsp-toolset-modern
   ```
2. Premi il tasto **`F5`** sulla tastiera (oppure vai nella scheda **Run and Debug** e clicca su **"Run Extension"**).
3. Si aprirà una nuova finestra di VS Code (**[Extension Development Host]**) con l'estensione attiva e il file `examples/sample.lts` già aperto.

---

### Metodo 2: Esecuzione dei Comandi FSP

Nei file con estensione `.lts` o `.fsp`:

1. **Compilazione del file**:
   - Premi `Cmd + Shift + P` (o `Ctrl + Shift + P` su Windows/Linux).
   - Digita e seleziona: `FSP: Compile Current File`.
   - L'estensione verificherà la sintassi con `ltsa.jar`:
     - Se non ci sono errori: riceverai la notifica di successo.
     - Se ci sono errori: verranno mostrati nella barra delle notifiche e sottolineati inline nel codice con indicazione nel pannello **Problems**.

2. **Visualizzazione Grafica dell'Automa a Stati**:
   - Clicca sull'icona **Grafo** in alto a destra nell'editor (nella barra del titolo dell'editor) oppure premi `Cmd + Shift + P` e scegli `FSP: Display Graph Visualisation`.
   - Verrà aperto un pannello laterale interattivo contenente l'automa.
   - **Interattività**:
     - **Menu a tendina "Process"**: permette di scegliere tra i singoli processi (`BUFFER`, `PRODUCER`, `CONSUMER`) o la composizione concorrente (`SYSTEM`).
     - **Zoom & Pan**: rotellina del mouse o trackpad per ingrandire/spostarsi.
     - **Drag & Drop**: trascina i nodi dello stato a piacimento.
     - **Stati colorati**: stato iniziale verde, stati di errore evidenziati.

---

### Metodo 3: Esecuzione della Suite di Test

Per verificare che la grammatica e il motore di compilazione siano integri:
```bash
cd /Users/edoardo/development_prdj/fsp-toolset-modern
npm test
```

Tutti i test verranno eseguiti con Mocha e TypeScript.

---

### Metodo 4: Impacchettamento e Installazione Diretta (.vsix)

Se desideri installare l'estensione in modo permanente sul tuo VS Code principale senza passare per la modalità di debug:

1. Compila il pacchetto VSIX:
   ```bash
   cd /Users/edoardo/development_prdj/fsp-toolset-modern
   npx @vscode/vsce package --no-dependencies
   ```
2. Installa il file generato in VS Code:
   ```bash
   code --install-extension fsp-toolset-modern-0.0.1.vsix
   ```
