import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFileSync } from 'child_process';

const jar = path.resolve(__dirname, '../../lib/ltsa.jar');
const bridge = path.resolve(__dirname, '../../dist');
const haveJar = fs.existsSync(jar) && fs.existsSync(path.join(bridge, 'FspBridge.class'));

function run(source: string, mode: string, target?: string): any {
    // A file in the OS temp dir, i.e. no workspace folder involved at all.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fsp-'));
    const file = path.join(dir, 'm.lts');
    fs.writeFileSync(file, source);
    try {
        const args = ['-cp', `${jar}${path.delimiter}${bridge}`, 'FspBridge', mode, file];
        if (target) { args.push(target); }
        return JSON.parse(execFileSync('java', args, { encoding: 'utf8' }));
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

const SRC = [
    'LOCK = (acquire -> release -> LOCK).',
    'USER = (acquire -> release -> USER).',
    'property SAFE = (acquire -> release -> SAFE).',
    'BAD = (acquire -> acquire -> STOP).',
    '||SYS = (USER || LOCK || SAFE).',
    '||BADSYS = (BAD || SAFE).',
    'DL = (a -> b -> STOP).'
].join('\n');

describe('FSP bridge (real LTSA engine)', function () {
    this.timeout(30000);
    before(function () { if (!haveJar) { this.skip(); } });

    it('lists composites and processes', () => {
        const r = run(SRC, 'list');
        assert.strictEqual(r.errors.length, 0);
        const names = r.targets.map((t: any) => `${t.kind}:${t.name}`);
        assert.ok(names.includes('composite:SYS'));
        assert.ok(names.includes('process:DL'));
    });

    it('reports a syntax error with a line number', () => {
        const r = run('P = (a -> .', 'list');
        assert.ok(r.errors.length > 0);
        assert.ok(r.errors[0].line >= 1);
    });

    it('draws a composition', () => {
        const r = run(SRC, 'graph', 'SYS');
        assert.strictEqual(r.machines.length, 1);
        assert.strictEqual(r.machines[0].name, 'SYS');
        assert.strictEqual(r.machines[0].states, 2);
    });

    it('draws a single process even when composites exist', () => {
        const r = run(SRC, 'graph', 'DL');
        assert.strictEqual(r.machines.length, 1);
        assert.strictEqual(r.machines[0].name, 'DL');
        assert.strictEqual(r.machines[0].transitions.length, 2);
    });

    it('extracts real state names for processes and compositions', () => {
        const testSrc = [
            'COIN = IDLE,',
            'IDLE = (insert -> SELECT),',
            'SELECT = (dispense -> IDLE).',
            '||SYS_COIN = (COIN).'
        ].join('\n');
        const rProc = run(testSrc, 'graph', 'COIN');
        assert.ok(rProc.machines[0].stateNames);
        assert.strictEqual(rProc.machines[0].stateNames['0'], 'IDLE');
        assert.strictEqual(rProc.machines[0].stateNames['1'], 'SELECT');

        const rComp = run(SRC, 'graph', 'SYS');
        assert.ok(rComp.machines[0].stateNames);
        assert.ok(rComp.machines[0].stateNames['0']);
        assert.ok(rComp.machines[0].stateNames['0'].includes('USER'));
    });

    it('detects a property violation with its trace', () => {
        const r = run(SRC, 'check', 'BADSYS');
        assert.strictEqual(r.verdict, 'violation');
        assert.deepStrictEqual(r.trace, ['release']);
    });

    it('detects a deadlock with its trace', () => {
        const r = run(SRC, 'check', 'DL');
        assert.strictEqual(r.verdict, 'violation');
        assert.deepStrictEqual(r.trace, ['a', 'b']);
    });

    it('accepts a correct system and its progress', () => {
        assert.strictEqual(run(SRC, 'check', 'SYS').verdict, 'ok');
        assert.strictEqual(run(SRC, 'progress', 'SYS').verdict, 'ok');
    });
});
