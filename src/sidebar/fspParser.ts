export type FspSymbolType = 'composite' | 'process' | 'property' | 'const' | 'range' | 'set';

export interface ParsedFspSymbol {
    name: string;
    kind: FspSymbolType;
    line: number;
    detail?: string;
}

export function parseFspSymbolsFromText(text: string): ParsedFspSymbol[] {
    const result: ParsedFspSymbol[] = [];
    const lines = text.split('\n');
    let inBlockComment = false;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];

        if (inBlockComment) {
            const closeIdx = line.indexOf('*/');
            if (closeIdx === -1) continue;
            line = line.substring(closeIdx + 2);
            inBlockComment = false;
        }
        const openIdx = line.indexOf('/*');
        if (openIdx !== -1) {
            const closeIdx = line.indexOf('*/', openIdx + 2);
            if (closeIdx !== -1) {
                line = line.substring(0, openIdx) + line.substring(closeIdx + 2);
            } else {
                line = line.substring(0, openIdx);
                inBlockComment = true;
            }
        }

        const commentIdx = line.indexOf('//');
        if (commentIdx !== -1) {
            line = line.substring(0, commentIdx);
        }

        const trimmed = line.trim();
        if (!trimmed) continue;

        // 1. Composite: [minimal|deterministic] ||NAME = ...
        const compMatch = trimmed.match(/^(?:minimal\s+|deterministic\s+)*\|\|\s*([A-Z][A-Za-z0-9_]*)\s*(?:\([^)]*\)|\[[^\]]*\])*\s*=/);
        if (compMatch) {
            result.push({
                name: compMatch[1],
                kind: 'composite',
                line: i,
                detail: '||'
            });
            continue;
        }

        // 2. Safety Property: property NAME = ...
        const propMatch = trimmed.match(/^property\s+(?:\|\|\s*)?([A-Z][A-Za-z0-9_]*)\s*(?:\([^)]*\)|\[[^\]]*\])*\s*=/);
        if (propMatch) {
            result.push({
                name: propMatch[1],
                kind: 'property',
                line: i,
                detail: 'property'
            });
            continue;
        }

        // 3. Constant: const NAME = val
        const constMatch = trimmed.match(/^const\s+([A-Za-z0-9_]+)\s*=\s*(.+)$/);
        if (constMatch) {
            result.push({
                name: constMatch[1],
                kind: 'const',
                line: i,
                detail: `= ${constMatch[2].trim()}`
            });
            continue;
        }

        // 4. Range: range NAME = low..high
        const rangeMatch = trimmed.match(/^range\s+([A-Za-z0-9_]+)\s*=\s*(.+)$/);
        if (rangeMatch) {
            result.push({
                name: rangeMatch[1],
                kind: 'range',
                line: i,
                detail: `= ${rangeMatch[2].trim()}`
            });
            continue;
        }

        // 5. Set: set NAME = { ... }
        const setMatch = trimmed.match(/^set\s+([A-Za-z0-9_]+)\s*=\s*(.+)$/);
        if (setMatch) {
            result.push({
                name: setMatch[1],
                kind: 'set',
                line: i,
                detail: setMatch[2].trim()
            });
            continue;
        }

        // 6. Standard Process: NAME = ... (not local sub-state following a comma)
        if (!isPreviousLineContinuation(lines, i)) {
            const procMatch = trimmed.match(/^(?:minimal\s+|deterministic\s+)*([A-Z][A-Za-z0-9_]*)\s*(?:\([^)]*\)|\[[^\]]*\])*\s*=/);
            if (procMatch) {
                result.push({
                    name: procMatch[1],
                    kind: 'process',
                    line: i,
                    detail: 'process'
                });
            }
        }
    }

    return result;
}

function isPreviousLineContinuation(lines: string[], currentIndex: number): boolean {
    for (let j = currentIndex - 1; j >= 0; j--) {
        let prev = lines[j];
        const cIdx = prev.indexOf('//');
        if (cIdx !== -1) prev = prev.substring(0, cIdx);
        prev = prev.trim();
        if (!prev) continue;
        return prev.endsWith(',');
    }
    return false;
}
