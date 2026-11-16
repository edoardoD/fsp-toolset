export interface WebviewHtmlOptions {
    styleUri: string;
    cytoscapeUri: string;
    dagreUri: string;
    cytoscapeDagreUri: string;
    scriptUri: string;
    cspSource?: string;
    nonce: string;
    initialProcessesJson: string;
}

export function buildWebviewHtml(options: WebviewHtmlOptions): string {
    const cspMeta = options.cspSource
        ? `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${options.cspSource} data: blob:; style-src ${options.cspSource} 'unsafe-inline'; script-src 'nonce-${options.nonce}';">`
        : '';

    return `<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    ${cspMeta}
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>FSP Studio</title>
    <link href="${options.styleUri}" rel="stylesheet">
</head>
<body>
    <!-- Top Main Toolbar -->
    <div id="toolbar">
        <div class="toolbar-group">
            <span class="toolbar-label">Target:</span>
            <select id="processSelect" title="Seleziona processo o composizione da visualizzare"></select>
        </div>
        <div class="toolbar-group">
            <span class="toolbar-label">Layout:</span>
            <select id="layoutSelect" title="Algoritmo di disposizione del grafo">
                <option value="dagre-lr">Orizzontale (Left → Right)</option>
                <option value="dagre-tb">Verticale (Top → Bottom)</option>
                <option value="breadthfirst">Gerarchico ad Albero</option>
                <option value="concentric">Concentrico</option>
                <option value="cose">Organico (Force-Directed)</option>
            </select>
        </div>
        <div class="toolbar-group">
            <span class="toolbar-label">Stati:</span>
            <select id="labelSelect" title="Modalità di visualizzazione etichette stati">
                <option value="matrix" selected>Matrice / Gruppi ([COFFEE, 1])</option>
                <option value="compact">Solo Valori ([COFFEE, 1])</option>
                <option value="name">Nome completo (MAKING[COFFEE][1])</option>
                <option value="both">ID + Nome</option>
                <option value="id">Solo ID</option>
            </select>
        </div>

        <div class="toolbar-divider"></div>

        <!-- Navigation & Filter Controls -->
        <div class="toolbar-group">
            <button id="btnFit" title="Centra e adatta il grafo alla finestra">🎯 Centra</button>
            <button id="btnZoomIn" title="Ingrandisci (Zoom in)">＋</button>
            <button id="btnZoomOut" title="Rimpicciolisci (Zoom out)">－</button>
            <button id="btnToggleError" class="btn-toggle" title="Nascondi o mostra lo stato ERROR e le transizioni di errore per pulire il grafo">🚫 Nascondi ERROR</button>
        </div>

        <div class="toolbar-divider"></div>

        <!-- Interactive Simulator & Formal Verification -->
        <div class="toolbar-group">
            <button id="btnSimulate" class="btn-accent" title="Attiva/Disattiva Simulatore Interattivo Passo-Passo">🎮 Simula</button>
            <button id="btnCheckSafety" title="Verifica Safety & Deadlock e mostra eventuale controesempio sul grafo">🛡️ Safety</button>
            <button id="btnCheckProgress" title="Verifica Progress e Liveness">🔄 Progress</button>
        </div>

        <div class="toolbar-divider"></div>

        <!-- Export & Live Sync -->
        <div class="toolbar-group">
            <button id="btnExportPng" title="Esporta grafo in PNG ad alta risoluzione">📷 PNG</button>
            <button id="btnExportSvg" title="Esporta grafo in formato vettoriale SVG">📐 SVG</button>
            <button id="btnLiveSync" class="btn-toggle active" title="Aggiornamento automatico in tempo reale mentre scrivi codice FSP">⚡ Live</button>
        </div>

        <span id="stateCount"></span>
    </div>

    <!-- Verification / Counterexample Trace Banner (hidden by default) -->
    <div id="traceBanner" class="banner hidden">
        <div class="banner-header">
            <span id="traceBannerTitle" class="banner-title"></span>
            <div class="banner-actions">
                <button id="btnReplayTrace" class="btn-small" title="Riproduci la traccia nel simulatore">▶️ Simula Traccia</button>
                <button id="btnClearTrace" class="btn-small" title="Nascondi evidenziazione traccia">✕ Chiudi</button>
            </div>
        </div>
        <div id="traceStepsContainer" class="trace-steps"></div>
    </div>

    <!-- Main Cytoscape Graph Canvas -->
    <div id="cy"></div>

    <!-- Interactive Simulator / Animator Drawer (hidden by default) -->
    <div id="simulatorPanel" class="sim-panel hidden">
        <div class="sim-header">
            <div class="sim-status">
                <span class="sim-badge">🎮 SIMULATORE</span>
                <span class="sim-state-label">Stato corrente: <strong id="simCurrentState">0</strong></span>
                <span id="simStateStatusBadge" class="state-pill"></span>
            </div>
            <div class="sim-controls">
                <button id="btnSimStepBack" title="Torna allo stato precedente" disabled>⏪ Indietro</button>
                <button id="btnSimReset" title="Torna allo stato iniziale (0)">⏮ Reset</button>
                <button id="btnSimClose" title="Esci dalla modalità simulatore">✕ Esci</button>
            </div>
        </div>
        <div class="sim-body">
            <div class="sim-actions-row">
                <span class="sim-section-title">Azioni abilitate (clicca qui o sul grafo):</span>
                <div id="simActionsList" class="sim-actions-list"></div>
            </div>
            <div class="sim-trace-row">
                <span class="sim-section-title">Percorso (<span id="simStepCount">0</span> passi):</span>
                <div id="simHistoryBreadcrumb" class="sim-breadcrumb"></div>
            </div>
        </div>
    </div>

    <script nonce="${options.nonce}">
        window.__INITIAL_PROCESSES__ = ${options.initialProcessesJson};
    </script>
    <script nonce="${options.nonce}" src="${options.cytoscapeUri}"></script>
    <script nonce="${options.nonce}" src="${options.dagreUri}"></script>
    <script nonce="${options.nonce}" src="${options.cytoscapeDagreUri}"></script>
    <script nonce="${options.nonce}" src="${options.scriptUri}"></script>
</body>
</html>`;
}
