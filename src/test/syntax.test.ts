import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';

describe('FSP Syntax and Configuration Tests', () => {
    it('should have a valid fsp.tmLanguage.json grammar file', () => {
        const grammarPath = path.resolve(__dirname, '../../syntaxes/fsp.tmLanguage.json');
        assert.ok(fs.existsSync(grammarPath), 'Grammar file should exist');
        
        const content = fs.readFileSync(grammarPath, 'utf8');
        const json = JSON.parse(content);
        
        assert.strictEqual(json.scopeName, 'source.fsp');
        assert.ok(json.patterns, 'Should define root patterns');
        assert.ok(json.repository, 'Should define repository elements');
        assert.ok(json.repository.keywords, 'Should have keyword definitions');
        assert.ok(json.repository.processes, 'Should have process name patterns');
        assert.ok(json.repository.actions, 'Should have action patterns');
    });

    it('should have a valid language-configuration.json', () => {
        const configPath = path.resolve(__dirname, '../../language-configuration.json');
        assert.ok(fs.existsSync(configPath), 'Configuration file should exist');
        
        const content = fs.readFileSync(configPath, 'utf8');
        const json = JSON.parse(content);
        
        assert.ok(json.comments, 'Should define comment syntax');
        assert.strictEqual(json.comments.lineComment, '//');
        assert.ok(json.brackets, 'Should define brackets');
    });
});
