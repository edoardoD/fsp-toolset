(function () {
    const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
    let cy = null;
    let processesData = [];
    let allTargetsList = [];
    let currentProcess = null;
    let liveSyncEnabled = true;
    let hideErrorState = false;

    // Simulator state
    let simActive = false;
    let simCurrentState = 0;
    let simHistory = []; // Array of { fromState, action, toState, edgeId }

    // Active counterexample trace state
    let activeTraceData = null; // { trace: string[], verdict: string, mode: string, target: string }

    // Register cytoscape-dagre if available
    if (typeof cytoscape !== 'undefined') {
        if (typeof cytoscapeDagre !== 'undefined') {
            cytoscape.use(cytoscapeDagre);
        } else if (typeof window.cytoscapeDagre !== 'undefined') {
            cytoscape.use(window.cytoscapeDagre);
        }
    }

    // DOM Elements
    const processSelect = document.getElementById('processSelect');
    const layoutSelect = document.getElementById('layoutSelect');
    const labelSelect = document.getElementById('labelSelect');
    const stateCount = document.getElementById('stateCount');
    const btnFit = document.getElementById('btnFit');
    const btnZoomIn = document.getElementById('btnZoomIn');
    const btnZoomOut = document.getElementById('btnZoomOut');
    const btnToggleError = document.getElementById('btnToggleError');
    const btnSimulate = document.getElementById('btnSimulate');
    const btnCheckSafety = document.getElementById('btnCheckSafety');
    const btnCheckProgress = document.getElementById('btnCheckProgress');
    const btnExportPng = document.getElementById('btnExportPng');
    const btnExportSvg = document.getElementById('btnExportSvg');
    const btnLiveSync = document.getElementById('btnLiveSync');

    // Trace Banner Elements
    const traceBanner = document.getElementById('traceBanner');
    const traceBannerTitle = document.getElementById('traceBannerTitle');
    const traceStepsContainer = document.getElementById('traceStepsContainer');
    const btnReplayTrace = document.getElementById('btnReplayTrace');
    const btnClearTrace = document.getElementById('btnClearTrace');

    // Simulator Drawer Elements
    const simulatorPanel = document.getElementById('simulatorPanel');
    const simCurrentStateEl = document.getElementById('simCurrentState');
    const simStateStatusBadge = document.getElementById('simStateStatusBadge');
    const simActionsList = document.getElementById('simActionsList');
    const simStepCount = document.getElementById('simStepCount');
    const simHistoryBreadcrumb = document.getElementById('simHistoryBreadcrumb');
    const btnSimStepBack = document.getElementById('btnSimStepBack');
    const btnSimReset = document.getElementById('btnSimReset');
    const btnSimClose = document.getElementById('btnSimClose');

    // Toolbar Event Listeners
    if (labelSelect) {
        labelSelect.addEventListener('change', () => {
            if (currentProcess) {
                renderGraph(currentProcess, true);
                if (simActive) updateSimulatorView();
            }
        });
    }

    if (processSelect) {
        processSelect.addEventListener('change', (e) => {
            const targetName = e.target.value;
            clearTraceBanner();
            const localProc = processesData.find(p => cleanName(p.name) === cleanName(targetName));
            if (localProc) {
                currentProcess = localProc;
                renderGraph(currentProcess, false);
                if (simActive) {
                    resetSimulation();
                }
            } else if (vscode) {
                vscode.postMessage({ command: 'selectTarget', target: targetName });
            }
        });
    }

    if (layoutSelect) {
        layoutSelect.addEventListener('change', () => {
            if (currentProcess) {
                renderGraph(currentProcess, false);
                if (simActive) updateSimulatorView();
            }
        });
    }

    if (btnFit) {
        btnFit.addEventListener('click', () => {
            if (cy) cy.fit(undefined, 40);
        });
    }

    if (btnZoomIn) {
        btnZoomIn.addEventListener('click', () => {
            if (cy) {
                cy.zoom({
                    level: cy.zoom() * 1.3,
                    renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 }
                });
            }
        });
    }

    if (btnZoomOut) {
        btnZoomOut.addEventListener('click', () => {
            if (cy) {
                cy.zoom({
                    level: cy.zoom() / 1.3,
                    renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 }
                });
            }
        });
    }

    if (btnToggleError) {
        btnToggleError.addEventListener('click', () => {
            hideErrorState = !hideErrorState;
            if (currentProcess) {
                renderGraph(currentProcess, false);
                if (simActive) updateSimulatorView();
            }
        });
    }

    if (btnSimulate) {
        btnSimulate.addEventListener('click', () => {
            if (simActive) {
                stopSimulation();
            } else {
                startSimulation();
            }
        });
    }

    if (btnCheckSafety) {
        btnCheckSafety.addEventListener('click', () => {
            const target = getCurrentTargetName();
            if (vscode && target) {
                vscode.postMessage({ command: 'runCheck', mode: 'check', target });
            }
        });
    }

    if (btnCheckProgress) {
        btnCheckProgress.addEventListener('click', () => {
            const target = getCurrentTargetName();
            if (vscode && target) {
                vscode.postMessage({ command: 'runCheck', mode: 'progress', target });
            }
        });
    }

    if (btnExportPng) {
        btnExportPng.addEventListener('click', () => {
            exportGraphPng();
        });
    }

    if (btnExportSvg) {
        btnExportSvg.addEventListener('click', () => {
            exportGraphSvg();
        });
    }

    if (btnLiveSync) {
        btnLiveSync.addEventListener('click', () => {
            liveSyncEnabled = !liveSyncEnabled;
            btnLiveSync.classList.toggle('active', liveSyncEnabled);
            if (vscode) {
                vscode.postMessage({ command: 'toggleLiveSync', enabled: liveSyncEnabled });
            }
        });
    }

    if (btnClearTrace) {
        btnClearTrace.addEventListener('click', () => {
            clearTraceBanner();
        });
    }

    if (btnReplayTrace) {
        btnReplayTrace.addEventListener('click', () => {
            if (activeTraceData && Array.isArray(activeTraceData.trace) && activeTraceData.trace.length > 0) {
                replayTraceInSimulator(activeTraceData.trace);
            }
        });
    }

    if (btnSimStepBack) {
        btnSimStepBack.addEventListener('click', () => {
            stepBackSimulation();
        });
    }

    if (btnSimReset) {
        btnSimReset.addEventListener('click', () => {
            resetSimulation();
        });
    }

    if (btnSimClose) {
        btnSimClose.addEventListener('click', () => {
            stopSimulation();
        });
    }

    window.addEventListener('resize', () => {
        if (cy) {
            cy.resize();
        }
    });

    // 1. Initial load from window.__INITIAL_PROCESSES__ if present
    if (window.__INITIAL_PROCESSES__ && Array.isArray(window.__INITIAL_PROCESSES__)) {
        loadData(window.__INITIAL_PROCESSES__, [], undefined, false);
    }

    // 2. Notify extension that webview is ready
    if (vscode) {
        vscode.postMessage({ command: 'ready' });
    }

    // 3. Listen for postMessage updates from Extension Host (or tests)
    window.addEventListener('message', event => {
        const message = event.data;
        if (!message) return;
        switch (message.command) {
            case 'loadProcesses':
                if (Array.isArray(message.processes)) {
                    loadData(
                        message.processes,
                        message.allTargets,
                        message.activeTarget,
                        !!message.preserveView
                    );
                }
                break;

            case 'startSimulation':
                startSimulation();
                break;

            case 'highlightTrace':
                applyTraceHighlight(
                    message.trace || [],
                    message.verdict || 'ok',
                    message.mode || 'check',
                    message.target || getCurrentTargetName()
                );
                break;
        }
    });

    function getCurrentTargetName() {
        if (processSelect && processSelect.value) {
            return processSelect.value;
        }
        return currentProcess ? cleanName(currentProcess.name) : '';
    }

    function cleanName(name) {
        if (!name) return 'Unknown';
        return String(name).replace(/\(\)$/, '');
    }

    /**
     * Parses an indexed state name like "MAKING[COFFEE][1]" or "RELEASE[TEA][→grab]"
     * into { prefix: "MAKING", indices: ["COFFEE", "1"], compactLabel: "[COFFEE, 1]" }
     */
    function parseIndexedState(rawName) {
        if (!rawName || typeof rawName !== 'string') {
            return { prefix: null, indices: [], compactLabel: '' };
        }
        const trimmed = rawName.trim();
        // Match a top-level identifier followed by one or more [...] groups
        const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)((?:\[[^\]]+\])+)$/);
        if (!match) {
            return { prefix: null, indices: [], compactLabel: trimmed };
        }
        const prefix = match[1];
        const bracketsPart = match[2];
        const indices = [];
        const re = /\[([^\]]+)\]/g;
        let m;
        while ((m = re.exec(bracketsPart)) !== null) {
            indices.push(m[1].trim());
        }
        return {
            prefix,
            indices,
            compactLabel: `[${indices.join(', ')}]`
        };
    }

    function loadData(processes, allTargets, activeTarget, preserveView) {
        processesData = processes || [];
        if (Array.isArray(allTargets) && allTargets.length > 0) {
            allTargetsList = allTargets;
        }

        updateProcessSelect(activeTarget);

        if (processesData.length > 0) {
            const match = activeTarget
                ? processesData.find(p => cleanName(p.name) === cleanName(activeTarget))
                : null;
            currentProcess = match || processesData[0];
            renderGraph(currentProcess, preserveView);

            if (simActive) {
                const maxS = typeof currentProcess.states === 'number' ? currentProcess.states : 0;
                if (simCurrentState >= maxS && simCurrentState !== -1) {
                    resetSimulation();
                } else {
                    updateSimulatorView();
                }
            }
        } else {
            showEmptyMessage('Nessun processo trovato o definibile nel file.');
        }
    }

    function updateProcessSelect(activeTarget) {
        if (!processSelect) return;
        const previousValue = activeTarget || processSelect.value;
        processSelect.innerHTML = '';

        const seen = new Set();
        const items = [];

        if (allTargetsList.length > 0) {
            allTargetsList.forEach(t => {
                const name = cleanName(t.name);
                if (!seen.has(name)) {
                    seen.add(name);
                    items.push({
                        name,
                        label: t.kind === 'composite' ? `|| ${name}` : name
                    });
                }
            });
        }

        processesData.forEach(p => {
            const name = cleanName(p.name);
            if (!seen.has(name)) {
                seen.add(name);
                items.push({ name, label: name });
            }
        });

        items.forEach(item => {
            const option = document.createElement('option');
            option.value = item.name;
            option.textContent = item.label;
            if (previousValue && cleanName(previousValue) === item.name) {
                option.selected = true;
            }
            processSelect.appendChild(option);
        });
    }

    function showEmptyMessage(msg) {
        const cyContainer = document.getElementById('cy');
        if (cyContainer) {
            cyContainer.innerHTML = `<div class="empty-state">${msg}</div>`;
        }
        if (stateCount) stateCount.textContent = '';
    }

    function getThemeColor(cssVar, fallback) {
        try {
            const div = document.createElement('div');
            div.style.color = `var(${cssVar})`;
            document.body.appendChild(div);
            const col = window.getComputedStyle(div).color;
            document.body.removeChild(div);
            if (col && col !== 'rgba(0, 0, 0, 0)' && col !== 'transparent') {
                return col;
            }
        } catch (e) {}
        return fallback;
    }

    function getLayoutConfig(layoutName) {
        const spacingFactor = 1.3;
        switch (layoutName) {
            case 'dagre-lr':
                return {
                    name: 'dagre',
                    rankDir: 'LR',
                    nodeSep: 50,
                    rankSep: 85,
                    edgeSep: 25,
                    align: 'DR',
                    animate: false
                };
            case 'dagre-tb':
                return {
                    name: 'dagre',
                    rankDir: 'TB',
                    nodeSep: 55,
                    rankSep: 75,
                    edgeSep: 25,
                    animate: false
                };
            case 'breadthfirst':
                return {
                    name: 'breadthfirst',
                    roots: '#n0',
                    directed: true,
                    padding: 40,
                    spacingFactor: spacingFactor,
                    animate: false
                };
            case 'concentric':
                return {
                    name: 'concentric',
                    concentric: function (node) {
                        if (node.id() === 'n0') return 10;
                        if (node.id() === 'n-1') return 0;
                        return 5;
                    },
                    levelWidth: function () { return 1; },
                    padding: 40,
                    animate: false
                };
            case 'cose':
                return {
                    name: 'cose',
                    animate: false,
                    nodeRepulsion: 8000,
                    idealEdgeLength: 80,
                    gravity: 0.25,
                    padding: 40
                };
            default:
                return {
                    name: 'dagre',
                    rankDir: 'LR',
                    nodeSep: 50,
                    rankSep: 85,
                    animate: false
                };
        }
    }

    function formatNodeLabel(id, process, groupedPrefixes) {
        const transitions = Array.isArray(process.transitions) ? process.transitions : [];
        const hasOutgoing = transitions.some(t => t.from === id);
        const isError = (id === -1);
        const isStop = !isError && !hasOutgoing;
        const stateNames = process.stateNames || {};
        const rawName = stateNames[id] || stateNames[String(id)];
        const hasName = typeof rawName === 'string' && rawName.trim() !== '';
        const displayName = hasName ? rawName : String(id);
        const stopSuffix = (isStop && !displayName.includes('STOP')) ? ' (STOP)' : '';
        const labelMode = labelSelect ? labelSelect.value : 'matrix';

        if (isError) {
            return 'ERROR';
        }
        if (labelMode === 'id') {
            return String(id) + (isStop ? ' (STOP)' : '');
        }
        if (labelMode === 'both') {
            return (hasName ? `${id}: ${rawName}` : String(id)) + stopSuffix;
        }
        if (labelMode === 'name') {
            return displayName + stopSuffix;
        }

        // 'matrix' or 'compact': extract inner bracket values [COFFEE, 1]
        if (hasName) {
            const parsed = parseIndexedState(rawName);
            if (parsed.prefix && parsed.indices.length > 0) {
                if (labelMode === 'compact') {
                    return parsed.compactLabel + stopSuffix;
                }
                if (labelMode === 'matrix') {
                    // If grouped in a parent box, show only [COFFEE, 1]; otherwise show prefix[COFFEE, 1]
                    if (groupedPrefixes && groupedPrefixes.has(parsed.prefix)) {
                        return parsed.compactLabel + stopSuffix;
                    }
                    return `${parsed.prefix}${parsed.compactLabel}` + stopSuffix;
                }
            }
        }
        return displayName + stopSuffix;
    }

    function updateToggleErrorButton(errorEdgeCount) {
        if (!btnToggleError) return;
        if (errorEdgeCount > 0) {
            btnToggleError.disabled = false;
            btnToggleError.classList.toggle('active', hideErrorState);
            btnToggleError.textContent = hideErrorState
                ? `👁️ Mostra ERROR (${errorEdgeCount})`
                : `🚫 Nascondi ERROR (${errorEdgeCount})`;
        } else {
            btnToggleError.disabled = true;
            btnToggleError.classList.remove('active');
            btnToggleError.textContent = '🚫 Nascondi ERROR';
        }
    }

    function renderGraph(process, preserveViewport) {
        const cyContainer = document.getElementById('cy');
        if (!cyContainer) return;

        let savedZoom = null;
        let savedPan = null;
        if (preserveViewport && cy) {
            savedZoom = cy.zoom();
            savedPan = { ...cy.pan() };
        }

        cyContainer.innerHTML = '';

        if (cy) {
            cy.destroy();
            cy = null;
            window.cy = null;
        }

        if (!process) {
            showEmptyMessage('Nessun dato di processo da mostrare.');
            return;
        }

        const allTransitions = Array.isArray(process.transitions) ? process.transitions : [];
        const declaredStates = typeof process.states === 'number' ? process.states : 0;

        const errorEdgesCount = allTransitions.filter(t => t.to === -1 || t.from === -1).length;
        updateToggleErrorButton(errorEdgesCount);

        const transitions = hideErrorState
            ? allTransitions.filter(t => t.to !== -1 && t.from !== -1)
            : allTransitions;

        if (stateCount) {
            const hiddenNote = (hideErrorState && errorEdgesCount > 0)
                ? ` (${errorEdgesCount} archi ERROR nascosti)`
                : '';
            stateCount.textContent = `${declaredStates} stati · ${transitions.length} transizioni${hiddenNote}`;
        }

        if (declaredStates > 3000) {
            showEmptyMessage(`Automa troppo grande per la visualizzazione grafica (${declaredStates} stati). Seleziona un singolo sottoprocesso dal menu in alto.`);
            return;
        }

        const elements = [];
        const nodeIds = new Set();

        for (let i = 0; i < declaredStates; i++) {
            nodeIds.add(i);
        }

        transitions.forEach(t => {
            if (typeof t.from === 'number') nodeIds.add(t.from);
            if (typeof t.to === 'number') nodeIds.add(t.to);
        });

        const hasOutgoing = new Set();
        allTransitions.forEach(t => hasOutgoing.add(t.from));

        const stateNames = process.stateNames || {};
        const selectedLayout = layoutSelect ? layoutSelect.value : 'dagre-lr';
        const labelMode = labelSelect ? labelSelect.value : 'matrix';
        const layoutSupportsCompound = (selectedLayout === 'dagre-lr' || selectedLayout === 'dagre-tb' || selectedLayout === 'cose');

        // Determine which indexed state prefixes (e.g. MAKING, RELEASE) have multiple states for grouping
        const prefixCounts = new Map();
        const nodePrefixMap = new Map();
        if (labelMode === 'matrix' && layoutSupportsCompound) {
            nodeIds.forEach(id => {
                if (id === -1) return;
                const rawName = stateNames[id] || stateNames[String(id)];
                const parsed = parseIndexedState(rawName);
                if (parsed.prefix && parsed.indices.length > 0) {
                    prefixCounts.set(parsed.prefix, (prefixCounts.get(parsed.prefix) || 0) + 1);
                    nodePrefixMap.set(id, parsed.prefix);
                }
            });
        }

        const groupedPrefixes = new Set();
        prefixCounts.forEach((count, prefix) => {
            if (count >= 2) {
                groupedPrefixes.add(prefix);
                elements.push({
                    data: {
                        id: `group_${prefix}`,
                        label: prefix,
                        isGroup: true
                    },
                    classes: 'state-group'
                });
            }
        });

        // Add State Nodes
        nodeIds.forEach(id => {
            const isError = (id === -1);
            const isStart = (id === 0);
            const isStop = !isError && !hasOutgoing.has(id);
            const rawName = stateNames[id] || stateNames[String(id)];
            const label = formatNodeLabel(id, process, groupedPrefixes);
            const prefix = nodePrefixMap.get(id);
            const parentGroup = (prefix && groupedPrefixes.has(prefix)) ? `group_${prefix}` : undefined;

            const nodeData = {
                id: `n${id}`,
                stateId: id,
                label: label,
                stateName: rawName || ''
            };
            if (parentGroup) {
                nodeData.parent = parentGroup;
            }

            elements.push({
                data: nodeData,
                classes: isStart ? 'start' : (isError ? 'error' : (isStop ? 'stop' : 'normal'))
            });
        });

        // Add Transition Edges
        transitions.forEach((t, i) => {
            elements.push({
                data: {
                    id: `e${i}`,
                    source: `n${t.from}`,
                    target: `n${t.to}`,
                    fromState: t.from,
                    toState: t.to,
                    action: t.label || '',
                    label: t.label || ''
                }
            });
        });

        const bodyBg = getThemeColor('--vscode-editor-background', '#1e1e1e');
        const bodyFg = getThemeColor('--vscode-editor-foreground', '#d4d4d4');
        const nodeBg = getThemeColor('--vscode-button-background', '#0e639c');
        const nodeFg = getThemeColor('--vscode-button-foreground', '#ffffff');
        const edgeLineColor = getThemeColor('--vscode-editorLineNumber-activeForeground', '#6c9bcf');

        const layoutConfig = getLayoutConfig(selectedLayout);

        try {
            cy = cytoscape({
                container: cyContainer,
                elements: elements,
                style: [
                    {
                        selector: 'node',
                        style: {
                            'background-color': nodeBg,
                            'label': 'data(label)',
                            'color': nodeFg,
                            'text-valign': 'center',
                            'text-halign': 'center',
                            'font-size': '12px',
                            'font-weight': '600',
                            'shape': 'round-rectangle',
                            'width': 'label',
                            'height': 'label',
                            'padding': '10px',
                            'border-width': 1.5,
                            'border-color': 'rgba(255, 255, 255, 0.25)',
                            'shadow-blur': 4,
                            'shadow-color': 'rgba(0, 0, 0, 0.3)',
                            'shadow-opacity': 0.5
                        }
                    },
                    // Compound Group Box Style (e.g. MAKING, RELEASE)
                    {
                        selector: 'node.state-group',
                        style: {
                            'background-color': 'rgba(108, 155, 207, 0.07)',
                            'background-opacity': 1,
                            'border-width': 1.5,
                            'border-style': 'dashed',
                            'border-color': 'rgba(108, 155, 207, 0.55)',
                            'shape': 'round-rectangle',
                            'padding': '18px',
                            'label': 'data(label)',
                            'color': edgeLineColor,
                            'font-size': '12px',
                            'font-weight': '700',
                            'text-valign': 'top',
                            'text-halign': 'center',
                            'text-margin-y': -6,
                            'shadow-opacity': 0
                        }
                    },
                    {
                        selector: '.start',
                        style: {
                            'background-color': '#28a745',
                            'shape': 'round-rectangle',
                            'border-width': 2.5,
                            'border-color': '#ffffff'
                        }
                    },
                    {
                        selector: '.stop',
                        style: {
                            'background-color': '#6c757d',
                            'shape': 'octagon',
                            'border-width': 2,
                            'border-color': '#adb5bd'
                        }
                    },
                    {
                        selector: '.error',
                        style: {
                            'background-color': '#d9534f',
                            'shape': 'diamond',
                            'padding': '14px',
                            'border-width': 2.5,
                            'border-color': '#ffcccc'
                        }
                    },
                    {
                        selector: 'edge',
                        style: {
                            'width': 1.8,
                            'line-color': edgeLineColor,
                            'target-arrow-color': edgeLineColor,
                            'target-arrow-shape': 'triangle',
                            'arrow-scale': 1.1,
                            'curve-style': 'bezier',
                            'control-point-step-size': 40,
                            'loop-direction': '-45deg',
                            'loop-sweep': '-90deg',
                            'label': 'data(label)',
                            'font-size': '11px',
                            'font-weight': '500',
                            'color': bodyFg,
                            'text-background-color': bodyBg,
                            'text-background-opacity': 0.9,
                            'text-background-padding': '3px',
                            'text-background-shape': 'roundrectangle',
                            'text-border-color': edgeLineColor,
                            'text-border-width': 0.5,
                            'text-border-opacity': 0.4,
                            'text-rotation': 'autorotate'
                        }
                    },
                    // Simulator Highlighting Styles
                    {
                        selector: 'node.sim-current',
                        style: {
                            'border-width': 4,
                            'border-color': '#f59e0b',
                            'shadow-blur': 14,
                            'shadow-color': '#f59e0b',
                            'shadow-opacity': 0.9
                        }
                    },
                    {
                        selector: 'node.sim-enabled-target',
                        style: {
                            'border-width': 2.5,
                            'border-color': '#fbbf24',
                            'border-style': 'dashed'
                        }
                    },
                    {
                        selector: 'edge.sim-enabled-edge',
                        style: {
                            'width': 3.2,
                            'line-color': '#f59e0b',
                            'target-arrow-color': '#f59e0b',
                            'text-border-color': '#f59e0b',
                            'text-border-width': 1.5,
                            'text-border-opacity': 1,
                            'z-index': 10
                        }
                    },
                    {
                        selector: '.sim-dimmed',
                        style: {
                            'opacity': 0.35
                        }
                    },
                    // Counterexample Trace Styles
                    {
                        selector: 'node.trace-node',
                        style: {
                            'border-width': 3.5,
                            'border-color': '#ef4444',
                            'shadow-blur': 12,
                            'shadow-color': '#ef4444',
                            'shadow-opacity': 0.85
                        }
                    },
                    {
                        selector: 'edge.trace-edge',
                        style: {
                            'width': 3.4,
                            'line-color': '#ef4444',
                            'target-arrow-color': '#ef4444',
                            'text-border-color': '#ef4444',
                            'text-border-width': 1.5,
                            'text-border-opacity': 1,
                            'z-index': 20
                        }
                    },
                    {
                        selector: ':selected',
                        style: {
                            'border-width': 3,
                            'border-color': '#ffd700',
                            'line-color': '#ffd700',
                            'target-arrow-color': '#ffd700'
                        }
                    }
                ],
                layout: layoutConfig
            });

            window.cy = cy;

            // Interactive click handlers on graph for Simulator mode
            cy.on('tap', 'edge', (evt) => {
                if (!simActive) return;
                const edge = evt.target;
                if (edge.data('fromState') === simCurrentState) {
                    stepSimulation(edge.data('action'), edge.data('toState'), edge.id());
                }
            });

            cy.on('tap', 'node', (evt) => {
                if (!simActive) return;
                const node = evt.target;
                if (node.isParent() || node.data('isGroup')) return;
                const targetStateId = node.data('stateId');
                const matchingEdges = cy.edges().filter(e =>
                    e.data('fromState') === simCurrentState && e.data('toState') === targetStateId
                );
                if (matchingEdges.length === 1) {
                    const edge = matchingEdges[0];
                    stepSimulation(edge.data('action'), targetStateId, edge.id());
                }
            });

            cy.ready(() => {
                if (preserveViewport && savedZoom !== null && savedPan !== null) {
                    cy.zoom(savedZoom);
                    cy.pan(savedPan);
                } else {
                    cy.fit(undefined, 40);
                }
            });

            if (activeTraceData && activeTraceData.verdict === 'violation') {
                highlightTraceOnGraph(activeTraceData.trace);
            }
        } catch (err) {
            console.error('Cytoscape render error:', err);
            try {
                cy = cytoscape({
                    container: cyContainer,
                    elements: elements.filter(e => !e.data.isGroup).map(e => {
                        const copy = { ...e, data: { ...e.data } };
                        delete copy.data.parent;
                        return copy;
                    }),
                    layout: getLayoutConfig('breadthfirst')
                });
                window.cy = cy;
                cy.ready(() => {
                    cy.fit(undefined, 40);
                });
            } catch (err2) {
                showEmptyMessage('Impossibile disegnare il grafo: ' + (err2 && err2.message ? err2.message : String(err2)));
            }
        }
    }

    // ==================== SIMULATOR / ANIMATOR LOGIC ====================

    function startSimulation() {
        if (!currentProcess || !cy) return;
        simActive = true;
        simCurrentState = 0;
        simHistory = [];
        if (btnSimulate) btnSimulate.classList.add('active');
        if (simulatorPanel) simulatorPanel.classList.remove('hidden');
        updateSimulatorView();
    }

    function stopSimulation() {
        simActive = false;
        if (btnSimulate) btnSimulate.classList.remove('active');
        if (simulatorPanel) simulatorPanel.classList.add('hidden');
        if (cy) {
            cy.elements().removeClass('sim-current sim-enabled-edge sim-enabled-target sim-dimmed');
        }
    }

    function resetSimulation() {
        if (!simActive) {
            startSimulation();
            return;
        }
        simCurrentState = 0;
        simHistory = [];
        updateSimulatorView();
    }

    function stepSimulation(action, toState, edgeId) {
        if (!simActive) return;
        if (toState === -1 && hideErrorState) {
            hideErrorState = false;
            renderGraph(currentProcess, true);
        }
        simHistory.push({
            fromState: simCurrentState,
            action: action,
            toState: toState,
            edgeId: edgeId
        });
        simCurrentState = toState;
        updateSimulatorView();
    }

    function stepBackSimulation() {
        if (!simActive || simHistory.length === 0) return;
        const lastStep = simHistory.pop();
        simCurrentState = lastStep.fromState;
        updateSimulatorView();
    }

    function updateSimulatorView() {
        if (!cy || !currentProcess) return;

        // 1. Update Cytoscape classes (never dim compound parent group boxes)
        cy.elements().removeClass('sim-current sim-enabled-edge sim-enabled-target sim-dimmed');
        cy.nodes().filter(n => !n.isParent() && !n.data('isGroup')).addClass('sim-dimmed');
        cy.edges().addClass('sim-dimmed');

        const currentNode = cy.getElementById(`n${simCurrentState}`);
        if (currentNode && currentNode.length > 0) {
            currentNode.removeClass('sim-dimmed').addClass('sim-current');
        }

        const outgoingEdges = cy.edges().filter(e => e.data('fromState') === simCurrentState);
        outgoingEdges.forEach(edge => {
            edge.removeClass('sim-dimmed').addClass('sim-enabled-edge');
            const targetNode = cy.getElementById(`n${edge.data('toState')}`);
            if (targetNode && targetNode.length > 0) {
                targetNode.removeClass('sim-dimmed');
                if (edge.data('toState') !== simCurrentState) {
                    targetNode.addClass('sim-enabled-target');
                }
            }
        });

        // 2. Update Simulator Drawer UI
        const stateNames = currentProcess.stateNames || {};
        const rawName = stateNames[simCurrentState] || stateNames[String(simCurrentState)];
        const stateDisplay = rawName ? `${simCurrentState} (${rawName})` : String(simCurrentState);
        if (simCurrentStateEl) {
            simCurrentStateEl.textContent = stateDisplay;
        }

        if (simStateStatusBadge) {
            simStateStatusBadge.className = 'state-pill';
            if (simCurrentState === -1) {
                simStateStatusBadge.textContent = '❌ ERROR STATE';
                simStateStatusBadge.classList.add('pill-error');
            } else if (outgoingEdges.length === 0) {
                simStateStatusBadge.textContent = '🛑 DEADLOCK / STOP';
                simStateStatusBadge.classList.add('pill-stop');
            } else if (simCurrentState === 0) {
                simStateStatusBadge.textContent = '🟢 Stato Iniziale';
                simStateStatusBadge.classList.add('pill-start');
            } else {
                simStateStatusBadge.textContent = '🔵 Stato Attivo';
                simStateStatusBadge.classList.add('pill-normal');
            }
        }

        if (btnSimStepBack) {
            btnSimStepBack.disabled = simHistory.length === 0;
        }

        if (simStepCount) {
            simStepCount.textContent = String(simHistory.length);
        }

        // 3. Populate Enabled Actions Buttons
        if (simActionsList) {
            simActionsList.innerHTML = '';
            if (outgoingEdges.length === 0) {
                const emptySpan = document.createElement('span');
                emptySpan.className = 'sim-no-actions';
                emptySpan.textContent = simCurrentState === -1
                    ? 'Stato di errore raggiunto (nessuna transizione).'
                    : 'Nessuna transizione uscente (STOP / Deadlock).';
                simActionsList.appendChild(emptySpan);
            } else {
                outgoingEdges.forEach(edge => {
                    const action = edge.data('action');
                    const toState = edge.data('toState');
                    const targetName = stateNames[toState] || stateNames[String(toState)];
                    const parsedTarget = parseIndexedState(targetName);
                    const shortTarget = parsedTarget.prefix ? parsedTarget.compactLabel : (targetName || String(toState));

                    const btn = document.createElement('button');
                    btn.className = 'sim-action-btn';
                    btn.setAttribute('data-action', action);
                    btn.setAttribute('data-to-state', String(toState));
                    btn.textContent = `${action} → ${toState === -1 ? 'ERROR' : shortTarget}`;
                    btn.title = `Esegui azione '${action}' verso lo stato ${targetName || toState}`;
                    btn.addEventListener('click', () => {
                        stepSimulation(action, toState, edge.id());
                    });
                    simActionsList.appendChild(btn);
                });
            }
        }

        // 4. Populate Breadcrumb History
        if (simHistoryBreadcrumb) {
            simHistoryBreadcrumb.innerHTML = '';
            const startSpan = document.createElement('span');
            startSpan.className = 'sim-crumb-state' + (simHistory.length === 0 ? ' active' : '');
            startSpan.textContent = stateNames[0] || '0';
            simHistoryBreadcrumb.appendChild(startSpan);

            simHistory.forEach((step, idx) => {
                const actSpan = document.createElement('span');
                actSpan.className = 'sim-crumb-action';
                actSpan.textContent = `──${step.action}──▶`;
                simHistoryBreadcrumb.appendChild(actSpan);

                const stSpan = document.createElement('span');
                const isLast = idx === simHistory.length - 1;
                stSpan.className = 'sim-crumb-state' + (isLast ? ' active' : '');
                const stName = stateNames[step.toState] || stateNames[String(step.toState)];
                const parsed = parseIndexedState(stName);
                stSpan.textContent = step.toState === -1
                    ? 'ERROR'
                    : (parsed.prefix ? parsed.compactLabel : (stName || String(step.toState)));
                simHistoryBreadcrumb.appendChild(stSpan);
            });
        }
    }

    // ==================== COUNTEREXAMPLE TRACE HIGHLIGHTING ====================

    function clearTraceBanner() {
        activeTraceData = null;
        if (traceBanner) {
            traceBanner.classList.add('hidden');
            traceBanner.classList.remove('banner-violation', 'banner-ok');
        }
        if (cy) {
            cy.elements().removeClass('trace-node trace-edge');
            cy.edges().forEach(edge => {
                edge.data('label', edge.data('action') || '');
            });
        }
    }

    function applyTraceHighlight(trace, verdict, mode, target) {
        activeTraceData = { trace, verdict, mode, target };
        const modeTitle = mode === 'progress' ? 'Progress Check' : 'Safety & Deadlock Check';

        if (!traceBanner || !traceBannerTitle || !traceStepsContainer) return;

        traceBanner.classList.remove('hidden', 'banner-violation', 'banner-ok');
        traceStepsContainer.innerHTML = '';

        if (verdict === 'ok') {
            traceBanner.classList.add('banner-ok');
            traceBannerTitle.textContent = `✅ ${modeTitle} (${target}): Nessuna violazione rilevata.`;
            if (btnReplayTrace) btnReplayTrace.classList.add('hidden');
            if (cy) {
                cy.elements().removeClass('trace-node trace-edge');
            }
            return;
        }

        // If error state was hidden, unhide it so the counterexample reaching ERROR is visible
        if (hideErrorState && currentProcess) {
            hideErrorState = false;
            renderGraph(currentProcess, true);
        }

        traceBanner.classList.add('banner-violation');
        traceBannerTitle.textContent = `❌ ${modeTitle} (${target}): Violazione rilevata (${trace.length} passi)`;
        if (btnReplayTrace) {
            btnReplayTrace.classList.toggle('hidden', trace.length === 0);
        }

        trace.forEach((action, idx) => {
            if (idx > 0) {
                const arrow = document.createElement('span');
                arrow.className = 'trace-arrow';
                arrow.textContent = '→';
                traceStepsContainer.appendChild(arrow);
            }
            const chip = document.createElement('span');
            chip.className = 'trace-step-chip';
            chip.textContent = `${idx + 1}. ${action}`;
            traceStepsContainer.appendChild(chip);
        });

        highlightTraceOnGraph(trace);
    }

    function highlightTraceOnGraph(trace) {
        if (!cy || !Array.isArray(trace) || trace.length === 0) return;

        cy.elements().removeClass('trace-node trace-edge');
        cy.edges().forEach(edge => {
            edge.data('label', edge.data('action') || '');
        });

        let curState = 0;
        const startNode = cy.getElementById('n0');
        if (startNode) startNode.addClass('trace-node');

        const stepNumbersPerEdge = new Map();

        for (let i = 0; i < trace.length; i++) {
            const action = trace[i];
            const matchingEdge = cy.edges().filter(e =>
                e.data('fromState') === curState && e.data('action') === action
            ).first();

            if (!matchingEdge || matchingEdge.length === 0) {
                break;
            }

            matchingEdge.addClass('trace-edge');
            const edgeId = matchingEdge.id();
            const prevSteps = stepNumbersPerEdge.get(edgeId) || [];
            prevSteps.push(i + 1);
            stepNumbersPerEdge.set(edgeId, prevSteps);

            const nextState = matchingEdge.data('toState');
            const nextNode = cy.getElementById(`n${nextState}`);
            if (nextNode) nextNode.addClass('trace-node');
            curState = nextState;
        }

        stepNumbersPerEdge.forEach((steps, edgeId) => {
            const edge = cy.getElementById(edgeId);
            if (edge) {
                const prefix = steps.map(s => `#${s}`).join(',');
                edge.data('label', `[${prefix}] ${edge.data('action')}`);
            }
        });
    }

    function replayTraceInSimulator(trace) {
        if (!cy || !Array.isArray(trace)) return;
        startSimulation();
        for (const action of trace) {
            const matchingEdge = cy.edges().filter(e =>
                e.data('fromState') === simCurrentState && e.data('action') === action
            ).first();
            if (!matchingEdge || matchingEdge.length === 0) break;
            stepSimulation(action, matchingEdge.data('toState'), matchingEdge.id());
        }
    }

    // ==================== GRAPHICAL EXPORT (PNG & SVG) ====================

    function exportGraphPng() {
        if (!cy) return '';
        const bodyBg = getThemeColor('--vscode-editor-background', '#1e1e1e');
        const pngDataUrl = cy.png({
            full: true,
            scale: 2,
            bg: bodyBg
        });
        const targetName = getCurrentTargetName() || 'automaton';
        window.__LAST_EXPORT__ = { format: 'png', data: pngDataUrl, targetName };
        if (vscode) {
            vscode.postMessage({
                command: 'exportImage',
                format: 'png',
                data: pngDataUrl,
                targetName
            });
        }
        return pngDataUrl;
    }

    function escapeXml(unsafe) {
        return String(unsafe)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    function exportGraphSvg() {
        if (!cy) return '';
        const bb = cy.elements().boundingBox();
        const pad = 40;
        const minX = Math.floor(bb.x1 - pad);
        const minY = Math.floor(bb.y1 - pad);
        const width = Math.max(200, Math.ceil(bb.w + pad * 2));
        const height = Math.max(150, Math.ceil(bb.h + pad * 2));

        const bodyBg = getThemeColor('--vscode-editor-background', '#1e1e1e');
        const bodyFg = getThemeColor('--vscode-editor-foreground', '#d4d4d4');
        const nodeBg = getThemeColor('--vscode-button-background', '#0e639c');
        const edgeLineColor = getThemeColor('--vscode-editorLineNumber-activeForeground', '#6c9bcf');

        const svgParts = [];
        svgParts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
        svgParts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" width="${width}" height="${height}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">`);
        svgParts.push(`  <defs>`);
        svgParts.push(`    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">`);
        svgParts.push(`      <path d="M 0 1 L 10 5 L 0 9 z" fill="${escapeXml(edgeLineColor)}" />`);
        svgParts.push(`    </marker>`);
        svgParts.push(`    <marker id="arrow-trace" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">`);
        svgParts.push(`      <path d="M 0 1 L 10 5 L 0 9 z" fill="#ef4444" />`);
        svgParts.push(`    </marker>`);
        svgParts.push(`  </defs>`);
        svgParts.push(`  <rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="${escapeXml(bodyBg)}" />`);

        // Render Compound Group Boxes first
        cy.nodes().filter(n => n.isParent() || n.data('isGroup')).forEach(group => {
            const gbb = group.boundingBox();
            const label = group.data('label') || '';
            svgParts.push(`  <rect x="${gbb.x1.toFixed(1)}" y="${gbb.y1.toFixed(1)}" width="${gbb.w.toFixed(1)}" height="${gbb.h.toFixed(1)}" rx="8" ry="8" fill="rgba(108,155,207,0.08)" stroke="${escapeXml(edgeLineColor)}" stroke-dasharray="5,4" stroke-width="1.5" />`);
            svgParts.push(`  <text x="${(gbb.x1 + gbb.w / 2).toFixed(1)}" y="${(gbb.y1 - 6).toFixed(1)}" fill="${escapeXml(edgeLineColor)}" font-size="12" font-weight="700" text-anchor="middle">${escapeXml(label)}</text>`);
        });

        // Render Edges
        cy.edges().forEach(edge => {
            const srcPos = edge.source().position();
            const tgtPos = edge.target().position();
            const isTrace = edge.hasClass('trace-edge');
            const stroke = isTrace ? '#ef4444' : edgeLineColor;
            const strokeWidth = isTrace ? 3 : 1.8;
            const marker = isTrace ? 'url(#arrow-trace)' : 'url(#arrow)';
            const label = edge.data('label') || '';

            if (edge.source().id() === edge.target().id()) {
                const x = srcPos.x;
                const y = srcPos.y - 18;
                const loopPath = `M ${x - 12} ${y} C ${x - 32} ${y - 45}, ${x + 32} ${y - 45}, ${x + 12} ${y}`;
                svgParts.push(`  <path d="${loopPath}" fill="none" stroke="${escapeXml(stroke)}" stroke-width="${strokeWidth}" marker-end="${marker}" />`);
                if (label) {
                    svgParts.push(`  <text x="${x}" y="${y - 38}" fill="${escapeXml(bodyFg)}" font-size="11" text-anchor="middle">${escapeXml(label)}</text>`);
                }
            } else {
                const dx = tgtPos.x - srcPos.x;
                const dy = tgtPos.y - srcPos.y;
                const dist = Math.hypot(dx, dy) || 1;
                const offset = 22;
                const endX = tgtPos.x - (dx / dist) * offset;
                const endY = tgtPos.y - (dy / dist) * offset;
                const midX = (srcPos.x + endX) / 2;
                const midY = (srcPos.y + endY) / 2;

                svgParts.push(`  <line x1="${srcPos.x.toFixed(1)}" y1="${srcPos.y.toFixed(1)}" x2="${endX.toFixed(1)}" y2="${endY.toFixed(1)}" stroke="${escapeXml(stroke)}" stroke-width="${strokeWidth}" marker-end="${marker}" />`);
                if (label) {
                    svgParts.push(`  <text x="${midX.toFixed(1)}" y="${(midY - 6).toFixed(1)}" fill="${escapeXml(bodyFg)}" font-size="11" font-weight="500" text-anchor="middle">${escapeXml(label)}</text>`);
                }
            }
        });

        // Render Regular State Nodes
        cy.nodes().filter(n => !n.isParent() && !n.data('isGroup')).forEach(node => {
            const pos = node.position();
            const w = Math.max(44, node.outerWidth());
            const h = Math.max(28, node.outerHeight());
            const x = pos.x - w / 2;
            const y = pos.y - h / 2;

            let fill = nodeBg;
            let stroke = 'rgba(255,255,255,0.35)';
            if (node.hasClass('start')) {
                fill = '#28a745';
                stroke = '#ffffff';
            } else if (node.hasClass('stop')) {
                fill = '#6c757d';
                stroke = '#adb5bd';
            } else if (node.hasClass('error')) {
                fill = '#d9534f';
                stroke = '#ffcccc';
            }
            if (node.hasClass('trace-node')) {
                stroke = '#ef4444';
            } else if (node.hasClass('sim-current')) {
                stroke = '#f59e0b';
            }

            const label = node.data('label') || '';
            svgParts.push(`  <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="6" ry="6" fill="${escapeXml(fill)}" stroke="${escapeXml(stroke)}" stroke-width="2" />`);
            svgParts.push(`  <text x="${pos.x.toFixed(1)}" y="${(pos.y + 4).toFixed(1)}" fill="#ffffff" font-size="12" font-weight="600" text-anchor="middle">${escapeXml(label)}</text>`);
        });

        svgParts.push(`</svg>`);
        const svgString = svgParts.join('\n');
        const targetName = getCurrentTargetName() || 'automaton';
        window.__LAST_EXPORT__ = { format: 'svg', data: svgString, targetName };
        if (vscode) {
            vscode.postMessage({
                command: 'exportImage',
                format: 'svg',
                data: svgString,
                targetName
            });
        }
        return svgString;
    }

    // Expose programmatic API on window.fspStudio for testing & automation
    window.fspStudio = {
        getCy: () => cy,
        getCurrentProcess: () => currentProcess,
        isSimulatorActive: () => simActive,
        isErrorHidden: () => hideErrorState,
        getSimulatorState: () => ({
            active: simActive,
            currentState: simCurrentState,
            history: [...simHistory]
        }),
        startSimulation,
        stopSimulation,
        resetSimulation,
        stepSimulation,
        stepBackSimulation,
        applyTraceHighlight,
        clearTraceBanner,
        exportGraphPng,
        exportGraphSvg
    };
})();
