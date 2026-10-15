(function () {
    const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
    let cy;
    let processesData = [];
    let currentProcess = null;

    // Register cytoscape-dagre if available
    if (typeof cytoscape !== 'undefined') {
        if (typeof cytoscapeDagre !== 'undefined') {
            cytoscape.use(cytoscapeDagre);
        } else if (typeof window.cytoscapeDagre !== 'undefined') {
            cytoscape.use(window.cytoscapeDagre);
        }
    }

    const processSelect = document.getElementById('processSelect');
    const layoutSelect = document.getElementById('layoutSelect');
    const stateCount = document.getElementById('stateCount');
    const btnFit = document.getElementById('btnFit');
    const btnZoomIn = document.getElementById('btnZoomIn');
    const btnZoomOut = document.getElementById('btnZoomOut');

    // Toolbar listeners
    if (processSelect) {
        processSelect.addEventListener('change', (e) => {
            const processName = e.target.value;
            const proc = processesData.find(p => p.name === processName);
            if (proc) {
                currentProcess = proc;
                renderGraph(proc);
            }
        });
    }

    if (layoutSelect) {
        layoutSelect.addEventListener('change', () => {
            if (currentProcess) {
                applyLayout(layoutSelect.value);
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

    window.addEventListener('resize', () => {
        if (cy) {
            cy.resize();
        }
    });

    // 1. Initial load from window.__INITIAL_PROCESSES__ if present
    if (window.__INITIAL_PROCESSES__ && Array.isArray(window.__INITIAL_PROCESSES__)) {
        loadData(window.__INITIAL_PROCESSES__);
    }

    // 2. Notify extension that webview is ready
    if (vscode) {
        vscode.postMessage({ command: 'ready' });
    }

    // 3. Listen for postMessage updates
    window.addEventListener('message', event => {
        const message = event.data;
        if (!message) return;
        switch (message.command) {
            case 'loadProcesses':
                if (Array.isArray(message.processes)) {
                    loadData(message.processes);
                }
                break;
        }
    });

    function cleanName(name) {
        if (!name) return 'Unknown';
        return name.replace(/\(\)$/, '');
    }

    function loadData(processes) {
        processesData = processes;
        updateProcessSelect();
        if (processesData.length > 0) {
            currentProcess = processesData[0];
            renderGraph(currentProcess);
        } else {
            showEmptyMessage('Nessun processo trovato o definibile nel file.');
        }
    }

    function updateProcessSelect() {
        if (!processSelect) return;
        processSelect.innerHTML = '';
        processesData.forEach(p => {
            const option = document.createElement('option');
            option.value = p.name;
            option.textContent = cleanName(p.name);
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

    // Helper to resolve CSS variables to actual computed RGB values
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
                    rankSep: 90,
                    edgeSep: 30,
                    align: 'DR',
                    animate: false
                };
            case 'dagre-tb':
                return {
                    name: 'dagre',
                    rankDir: 'TB',
                    nodeSep: 60,
                    rankSep: 80,
                    edgeSep: 30,
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
                    rankSep: 90,
                    animate: false
                };
        }
    }

    function applyLayout(layoutName) {
        if (!cy) return;
        const config = getLayoutConfig(layoutName);
        try {
            const l = cy.layout(config);
            l.run();
            cy.fit(undefined, 40);
        } catch (err) {
            console.warn(`Layout '${layoutName}' failed, falling back to 'breadthfirst':`, err);
            try {
                const fallbackLayout = cy.layout(getLayoutConfig('breadthfirst'));
                fallbackLayout.run();
                cy.fit(undefined, 40);
            } catch (fallbackErr) {
                console.error('Fallback layout also failed:', fallbackErr);
            }
        }
    }

    function renderGraph(process) {
        const cyContainer = document.getElementById('cy');
        if (!cyContainer) return;
        cyContainer.innerHTML = '';

        if (cy) {
            cy.destroy();
            cy = null;
        }

        if (!process) {
            showEmptyMessage('Nessun dato di processo da mostrare.');
            return;
        }

        const transitions = Array.isArray(process.transitions) ? process.transitions : [];
        const declaredStates = typeof process.states === 'number' ? process.states : 0;

        if (stateCount) {
            stateCount.textContent = `${declaredStates} stati, ${transitions.length} transizioni`;
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
        transitions.forEach(t => hasOutgoing.add(t.from));

        // Add Nodes
        nodeIds.forEach(id => {
            const isError = (id === -1);
            const isStart = (id === 0);
            const isStop = !isError && !hasOutgoing.has(id);
            const label = isError ? 'ERROR' : (isStop ? String(id) + ' (STOP)' : String(id));

            elements.push({
                data: {
                    id: `n${id}`,
                    label: label
                },
                classes: isStart ? 'start' : (isError ? 'error' : (isStop ? 'stop' : 'normal'))
            });
        });

        // Add Edges
        transitions.forEach((t, i) => {
            elements.push({
                data: {
                    id: `e${i}`,
                    source: `n${t.from}`,
                    target: `n${t.to}`,
                    label: t.label || ''
                }
            });
        });

        // Resolve exact theme colors dynamically
        const bodyBg = getThemeColor('--vscode-editor-background', '#1e1e1e');
        const bodyFg = getThemeColor('--vscode-editor-foreground', '#d4d4d4');
        const nodeBg = getThemeColor('--vscode-button-background', '#0e639c');
        const nodeFg = getThemeColor('--vscode-button-foreground', '#ffffff');
        const edgeLineColor = getThemeColor('--vscode-editorLineNumber-activeForeground', '#6c9bcf');

        const selectedLayout = layoutSelect ? layoutSelect.value : 'dagre-lr';
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
                            'width': '36px',
                            'height': '36px',
                            'border-width': 1.5,
                            'border-color': 'rgba(255, 255, 255, 0.25)',
                            'shadow-blur': 4,
                            'shadow-color': 'rgba(0, 0, 0, 0.3)',
                            'shadow-opacity': 0.5
                        }
                    },
                    {
                        selector: '.start',
                        style: {
                            'background-color': '#28a745',
                            'shape': 'round-rectangle',
                            'border-width': 2,
                            'border-color': '#ffffff',
                            'width': '40px',
                            'height': '36px'
                        }
                    },
                    {
                        selector: '.stop',
                        style: {
                            'background-color': '#6c757d',
                            'shape': 'octagon',
                            'width': '52px',
                            'height': '44px',
                            'font-size': '10px'
                        }
                    },
                    {
                        selector: '.error',
                        style: {
                            'background-color': '#d9534f',
                            'shape': 'diamond',
                            'width': '46px',
                            'height': '46px',
                            'border-width': 2,
                            'border-color': '#ffffff'
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

            // Center and fit nicely
            cy.ready(() => {
                cy.fit(undefined, 40);
            });
        } catch (err) {
            console.error('Cytoscape render error:', err);
            // If the initial layout failed (e.g. dagre plugin issue), retry with breadthfirst
            try {
                cy = cytoscape({
                    container: cyContainer,
                    elements: elements,
                    layout: getLayoutConfig('breadthfirst')
                });
                cy.ready(() => {
                    cy.fit(undefined, 40);
                });
            } catch (err2) {
                showEmptyMessage('Impossibile disegnare il grafo: ' + (err2 && err2.message ? err2.message : String(err2)));
            }
        }
    }
})();
