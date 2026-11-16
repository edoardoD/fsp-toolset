import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { chromium, Browser, Page } from 'playwright';
import { buildWebviewHtml } from '../webview/htmlBuilder';
import { parseFspSymbolsFromText } from '../sidebar/fspParser';

const projectRoot = path.resolve(__dirname, '../..');
const jar = path.join(projectRoot, 'lib', 'ltsa.jar');
const bridge = path.join(projectRoot, 'dist');
const mediaDir = path.join(projectRoot, 'media');
const haveJar = fs.existsSync(jar) && fs.existsSync(path.join(bridge, 'FspBridge.class'));

function runBridgeSync(source: string, mode: string, target?: string): any {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fsp-ui-'));
    const file = path.join(dir, 'model.lts');
    fs.writeFileSync(file, source, 'utf8');
    try {
        const args = ['-Djava.awt.headless=true', '-cp', `${jar}${path.delimiter}${bridge}`, 'FspBridge', mode, file];
        if (target) {
            args.push(target);
        }
        return JSON.parse(execFileSync('java', args, { encoding: 'utf8' }));
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

const FSP_MODEL = [
    'const MAX = 2',
    'range R = 0..MAX',
    'set Actions = {acquire, release}',
    'COIN = IDLE,',
    'IDLE = (insert -> SELECT),',
    'SELECT = (dispense -> IDLE | cancel -> STOP).',
    'property SAFE = (insert -> dispense -> SAFE).',
    '||SYS = (COIN || SAFE).'
].join('\n');

const COFFEE_MACHINE_MODEL = [
    'const MAX_STEPS = 3',
    'const COFFEE = 1',
    'const TEA = 2',
    'range RANGE_STEPS = 1..MAX_STEPS',
    'range BEVERAGES = 1..2',
    '',
    'COFFE_MACHINE = IDLE,',
    'IDLE =',
    '  (coffee_button_pressed -> MAKING[COFFEE][1]',
    '  |tea_button_pressed -> MAKING[TEA][1]',
    '  |failure -> ERROR),',
    'MAKING[bev:BEVERAGES][i:RANGE_STEPS] =',
    '  (when i < MAX_STEPS step -> MAKING[bev][i+1]',
    '  |when i == MAX_STEPS step -> RELEASE[bev]',
    '  |failure -> ERROR),',
    'RELEASE[bev:BEVERAGES] =',
    '  (output[bev] -> grab -> IDLE',
    '  |failure -> ERROR).'
].join('\n');

function findChromiumExecutable(): string | undefined {
    try {
        const defaultPath = chromium.executablePath();
        if (defaultPath && fs.existsSync(defaultPath)) {
            return defaultPath;
        }
    } catch {
        // fallback below
    }
    const cacheDir = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
    if (fs.existsSync(cacheDir)) {
        const entries = fs.readdirSync(cacheDir).filter(e => e.startsWith('chromium-')).sort().reverse();
        for (const entry of entries) {
            const candidate = path.join(cacheDir, entry, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium');
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
    }
    return undefined;
}

describe('FSP Studio Parser & Playwright Graphical Webview Verification', function () {
    this.timeout(60000);

    let browser: Browser | undefined;
    let page: Page | undefined;
    let tempHtmlDir: string | undefined;

    before(async function () {
        if (!haveJar) {
            this.skip();
        }
        const executablePath = findChromiumExecutable();
        browser = await chromium.launch({
            headless: true,
            ...(executablePath ? { executablePath } : {})
        });
        page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    });

    after(async function () {
        if (page) await page.close();
        if (browser) await browser.close();
        if (tempHtmlDir && fs.existsSync(tempHtmlDir)) {
            fs.rmSync(tempHtmlDir, { recursive: true, force: true });
        }
    });

    it('correctly parses FSP symbols (composites, processes, properties, const, range, set) without confusing local sub-states', () => {
        const symbols = parseFspSymbolsFromText(FSP_MODEL);
        const byKindAndName = symbols.map(s => `${s.kind}:${s.name}`);

        assert.ok(byKindAndName.includes('const:MAX'), 'Should detect const MAX');
        assert.ok(byKindAndName.includes('range:R'), 'Should detect range R');
        assert.ok(byKindAndName.includes('set:Actions'), 'Should detect set Actions');
        assert.ok(byKindAndName.includes('process:COIN'), 'Should detect top-level process COIN');
        assert.ok(byKindAndName.includes('property:SAFE'), 'Should detect safety property SAFE');
        assert.ok(byKindAndName.includes('composite:SYS'), 'Should detect composite ||SYS');

        // Local sub-states IDLE and SELECT follow commas and must not be listed as separate top-level processes
        assert.ok(!byKindAndName.includes('process:IDLE'), 'Should not treat local state IDLE as top-level process');
        assert.ok(!byKindAndName.includes('process:SELECT'), 'Should not treat local state SELECT as top-level process');
    });

    it('renders the LTSA automaton graphically on the Cytoscape HTML5 Canvas', async () => {
        assert.ok(page, 'Playwright page should be initialized');

        const graphResult = runBridgeSync(FSP_MODEL, 'graph', 'COIN');
        assert.strictEqual(graphResult.errors.length, 0);
        assert.strictEqual(graphResult.machines.length, 1);

        tempHtmlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fsp-webview-'));
        const htmlPath = path.join(tempHtmlDir, 'index.html');

        const html = buildWebviewHtml({
            styleUri: `file://${path.join(mediaDir, 'graph.css')}`,
            cytoscapeUri: `file://${path.join(mediaDir, 'cytoscape.min.js')}`,
            dagreUri: `file://${path.join(mediaDir, 'dagre.min.js')}`,
            cytoscapeDagreUri: `file://${path.join(mediaDir, 'cytoscape-dagre.js')}`,
            scriptUri: `file://${path.join(mediaDir, 'graph.js')}`,
            nonce: 'test-nonce-123',
            initialProcessesJson: JSON.stringify(graphResult.machines)
        });
        fs.writeFileSync(htmlPath, html, 'utf8');

        await page.goto(`file://${htmlPath}`, { waitUntil: 'load' });
        await page.waitForSelector('#cy canvas');

        const graphStats = await page.evaluate(() => {
            const cy = (window as any).cy;
            const canvas = document.querySelector('#cy canvas') as HTMLCanvasElement | null;
            return {
                hasCy: !!cy,
                nodeCount: cy ? cy.nodes().length : 0,
                edgeCount: cy ? cy.edges().length : 0,
                startNodes: cy ? cy.nodes('.start').length : 0,
                stopNodes: cy ? cy.nodes('.stop').length : 0,
                canvasWidth: canvas ? canvas.width : 0,
                canvasHeight: canvas ? canvas.height : 0,
                stateCountText: document.getElementById('stateCount')?.textContent || ''
            };
        });

        assert.strictEqual(graphStats.hasCy, true, 'window.cy instance must be initialized');
        assert.strictEqual(graphStats.nodeCount, 3, 'COIN has 3 states (IDLE, SELECT, STOP)');
        assert.strictEqual(graphStats.edgeCount, 3, 'COIN has 3 transitions (insert, dispense, cancel)');
        assert.strictEqual(graphStats.startNodes, 1, 'Must have 1 start state (.start)');
        assert.strictEqual(graphStats.stopNodes, 1, 'Must have 1 deadlock/stop state (.stop)');
        assert.ok(graphStats.canvasWidth > 200 && graphStats.canvasHeight > 200, 'Canvas must have non-zero rendered dimensions');
        assert.ok(graphStats.stateCountText.includes('3 stati'), 'Toolbar should show state count');
    });

    it('dynamically updates node labels and layouts via toolbar controls', async () => {
        assert.ok(page);

        await page.selectOption('#labelSelect', 'both');
        const labelBoth = await page.evaluate(() => (window as any).cy.getElementById('n0').data('label'));
        assert.strictEqual(labelBoth, '0: IDLE');

        await page.selectOption('#labelSelect', 'id');
        const labelId = await page.evaluate(() => (window as any).cy.getElementById('n0').data('label'));
        assert.strictEqual(labelId, '0');

        await page.selectOption('#labelSelect', 'matrix');
        const labelMatrix = await page.evaluate(() => (window as any).cy.getElementById('n0').data('label'));
        assert.strictEqual(labelMatrix, 'IDLE');

        for (const layout of ['dagre-tb', 'breadthfirst', 'concentric', 'cose', 'dagre-lr']) {
            await page.selectOption('#layoutSelect', layout);
            const nodeCount: number = await page.evaluate(() => (window as any).cy.nodes().length);
            assert.strictEqual(nodeCount, 3);
        }
    });

    it('automates the Interactive Simulator / Animator step-by-step on the graph', async () => {
        assert.ok(page);

        await page.click('#btnSimulate');

        const isPanelVisible = await page.evaluate(() => {
            const panel = document.getElementById('simulatorPanel');
            return panel && !panel.classList.contains('hidden');
        });
        assert.strictEqual(isPanelVisible, true, 'Simulator drawer should be visible');

        let simState = await page.evaluate(() => (window as any).fspStudio.getSimulatorState());
        assert.strictEqual(simState.active, true);
        assert.strictEqual(simState.currentState, 0);

        await page.click('.sim-action-btn[data-action="insert"]');

        simState = await page.evaluate(() => (window as any).fspStudio.getSimulatorState());
        assert.strictEqual(simState.currentState, 1, 'After insert, simulator should be in state 1 (SELECT)');
        assert.strictEqual(simState.history.length, 1);

        const isNode1Active = await page.evaluate(() => (window as any).cy.getElementById('n1').hasClass('sim-current'));
        assert.strictEqual(isNode1Active, true, 'State 1 node should have .sim-current class on canvas');

        await page.click('.sim-action-btn[data-action="cancel"]');
        const badgeText = await page.textContent('#simStateStatusBadge');
        assert.ok(badgeText?.includes('DEADLOCK') || badgeText?.includes('STOP'), 'Should indicate Deadlock/STOP state');

        await page.click('#btnSimStepBack');
        simState = await page.evaluate(() => (window as any).fspStudio.getSimulatorState());
        assert.strictEqual(simState.currentState, 1, 'Step Back should return to state 1');

        await page.click('#btnSimReset');
        simState = await page.evaluate(() => (window as any).fspStudio.getSimulatorState());
        assert.strictEqual(simState.currentState, 0, 'Reset should return to state 0');

        await page.click('#btnSimClose');
    });

    it('highlights counterexample violation traces on the graph and replays them', async () => {
        assert.ok(page);

        const sysGraph = runBridgeSync(FSP_MODEL, 'graph', 'SYS');
        const sysCheck = runBridgeSync(FSP_MODEL, 'check', 'SYS');
        assert.strictEqual(sysCheck.verdict, 'violation');
        assert.ok(sysCheck.trace.length > 0);

        await page.evaluate(({ machines, trace, verdict }) => {
            window.postMessage({
                command: 'loadProcesses',
                processes: machines,
                activeTarget: 'SYS'
            }, '*');
            window.postMessage({
                command: 'highlightTrace',
                trace,
                verdict,
                mode: 'check',
                target: 'SYS'
            }, '*');
        }, { machines: sysGraph.machines, trace: sysCheck.trace, verdict: sysCheck.verdict });

        await page.waitForSelector('#traceBanner.banner-violation');

        const traceHighlightStats = await page.evaluate(() => {
            const cy = (window as any).cy;
            return {
                traceNodes: cy.nodes('.trace-node').length,
                traceEdges: cy.edges('.trace-edge').length,
                bannerTitle: document.getElementById('traceBannerTitle')?.textContent || '',
                stepChips: document.querySelectorAll('.trace-step-chip').length
            };
        });

        assert.ok(traceHighlightStats.traceNodes >= 2, 'Counterexample nodes must be highlighted with .trace-node');
        assert.ok(traceHighlightStats.traceEdges >= 1, 'Counterexample edges must be highlighted with .trace-edge');
        assert.strictEqual(traceHighlightStats.stepChips, sysCheck.trace.length, 'Should render a chip for each trace step');

        await page.click('#btnReplayTrace');
        const finalSimState = await page.evaluate(() => (window as any).fspStudio.getSimulatorState());
        assert.strictEqual(finalSimState.active, true);
        assert.strictEqual(finalSimState.history.length, sysCheck.trace.length);
        await page.click('#btnSimClose');
        await page.click('#btnClearTrace');
    });

    it('resolves matrix values ([COFFEE, 1]), groups MAKING/RELEASE boxes, names intermediate states, and toggles ERROR visibility', async () => {
        assert.ok(page);

        const coffeeRes = runBridgeSync(COFFEE_MACHINE_MODEL, 'graph', 'COFFE_MACHINE');
        assert.strictEqual(coffeeRes.errors.length, 0);
        const proc = coffeeRes.machines[0];

        // Load COFFE_MACHINE into the Webview in default 'matrix' mode
        await page.evaluate((machines) => {
            window.postMessage({
                command: 'loadProcesses',
                processes: machines,
                activeTarget: 'COFFE_MACHINE'
            }, '*');
        }, coffeeRes.machines);

        const matrixInfo = await page.evaluate(() => {
            const cy = (window as any).cy;
            const groupLabels = cy.nodes('.state-group').map((n: any) => n.data('label'));
            const stateLabels = cy.nodes().filter((n: any) => !n.isParent() && !n.data('isGroup')).map((n: any) => n.data('label'));
            const edgeLabels = cy.edges().map((e: any) => e.data('label'));
            return {
                groupLabels,
                stateLabels,
                edgeLabels,
                totalEdges: cy.edges().length,
                hasErrorNode: cy.getElementById('n-1').length > 0
            };
        });

        // 1. Compound group boxes MAKING and RELEASE must exist
        assert.ok(matrixInfo.groupLabels.includes('MAKING'), 'Should create MAKING group box');
        assert.ok(matrixInfo.groupLabels.includes('RELEASE'), 'Should create RELEASE group box');

        // 2. Inside MAKING, labels must be compact matrix contents [COFFEE, 1..3] and [TEA, 1..3]
        assert.ok(matrixInfo.stateLabels.includes('[COFFEE, 1]'), 'Should show [COFFEE, 1] instead of MAKING[1][1]');
        assert.ok(matrixInfo.stateLabels.includes('[COFFEE, 2]'), 'Should show [COFFEE, 2]');
        assert.ok(matrixInfo.stateLabels.includes('[COFFEE, 3]'), 'Should show [COFFEE, 3]');
        assert.ok(matrixInfo.stateLabels.includes('[TEA, 1]'), 'Should show [TEA, 1] instead of MAKING[2][1]');
        assert.ok(matrixInfo.stateLabels.includes('[TEA, 2]'), 'Should show [TEA, 2]');
        assert.ok(matrixInfo.stateLabels.includes('[TEA, 3]'), 'Should show [TEA, 3]');

        // 3. Intermediate states 10 and 5 after output[bev] must have readable labels [COFFEE, →grab] and [TEA, →grab]
        assert.ok(matrixInfo.stateLabels.includes('[COFFEE, →grab]'), 'Intermediate state 10 should be labeled [COFFEE, →grab]');
        assert.ok(matrixInfo.stateLabels.includes('[TEA, →grab]'), 'Intermediate state 5 should be labeled [TEA, →grab]');
        assert.ok(!matrixInfo.stateLabels.includes('10'), 'Raw state number 10 should no longer appear');
        assert.ok(!matrixInfo.stateLabels.includes('5'), 'Raw state number 5 should no longer appear');

        // 4. Symbolic action labels output[COFFEE] and output[TEA]
        assert.ok(matrixInfo.edgeLabels.includes('output[COFFEE]'), 'Should resolve output.1 to output[COFFEE]');
        assert.ok(matrixInfo.edgeLabels.includes('output[TEA]'), 'Should resolve output.2 to output[TEA]');

        // 5. Toggle "Nascondi ERROR" (#btnToggleError) hides the ERROR node and all 9 failure transitions
        assert.strictEqual(matrixInfo.totalEdges, 21);
        assert.strictEqual(matrixInfo.hasErrorNode, true);

        await page.click('#btnToggleError');
        const afterHideError = await page.evaluate(() => {
            const cy = (window as any).cy;
            return {
                totalEdges: cy.edges().length,
                hasErrorNode: cy.getElementById('n-1').length > 0,
                isHiddenFlag: (window as any).fspStudio.isErrorHidden()
            };
        });
        assert.strictEqual(afterHideError.isHiddenFlag, true);
        assert.strictEqual(afterHideError.hasErrorNode, false, 'ERROR node must be hidden when toggle is active');
        assert.strictEqual(afterHideError.totalEdges, 12, 'All 9 failure->ERROR edges must be hidden (21 - 9 = 12)');

        // Restore ERROR visibility
        await page.click('#btnToggleError');
        const afterRestoreError = await page.evaluate(() => (window as any).cy.edges().length);
        assert.strictEqual(afterRestoreError, 21);
    });

    it('exports high-resolution PNG and vector SVG and verifies visual screenshot', async () => {
        assert.ok(page);

        await page.click('#btnExportPng');
        const pngExport = await page.evaluate(() => (window as any).__LAST_EXPORT__);
        assert.strictEqual(pngExport.format, 'png');
        assert.ok(pngExport.data.startsWith('data:image/png;base64,'), 'PNG export should produce valid base64 PNG data URL');
        assert.ok(pngExport.data.length > 1000, 'PNG data URL should have substantial image content');

        await page.click('#btnExportSvg');
        const svgExport = await page.evaluate(() => (window as any).__LAST_EXPORT__);
        assert.strictEqual(svgExport.format, 'svg');
        assert.ok(svgExport.data.includes('<svg xmlns="http://www.w3.org/2000/svg"'), 'SVG export must contain valid <svg> root');
        assert.ok(svgExport.data.includes('<rect'), 'SVG export must render state nodes and group boxes');

        const screenshotBuffer = await page.screenshot({ fullPage: true });
        assert.strictEqual(screenshotBuffer[0], 0x89);
        assert.strictEqual(screenshotBuffer[1], 0x50);
        assert.strictEqual(screenshotBuffer[2], 0x4e);
        assert.strictEqual(screenshotBuffer[3], 0x47);
        assert.ok(screenshotBuffer.length > 10000, 'Playwright visual screenshot should be a valid non-empty PNG');
    });
});
