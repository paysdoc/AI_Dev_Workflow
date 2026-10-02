import { readFileSync } from 'fs';
import * as Gherkin from '@cucumber/gherkin';
import { IdGenerator } from '@cucumber/messages';
const files = process.argv.slice(2);
for (const f of files) {
  const builder = new Gherkin.AstBuilder(IdGenerator.uuid());
  const matcher = new Gherkin.GherkinClassicTokenMatcher();
  const parser = new Gherkin.Parser(builder, matcher);
  try {
    const doc = parser.parse(readFileSync(f, 'utf-8'));
    const feat = doc.feature;
    console.log(`OK ${f}\n  tags: ${feat.tags.map(t => t.name).join(' ')}\n  feature: ${feat.name.slice(0, 80)}`);
    for (const child of feat.children) {
      if (child.background) console.log(`  Background: ${child.background.steps.length} steps`);
      if (child.scenario) {
        const s = child.scenario;
        console.log(`  [${s.keyword}] ${s.name}\n     tags=${s.tags.map(t=>t.name).join(' ')} steps=${s.steps.length} examples=${s.examples.reduce((n,e)=>n+e.tableBody.length,0)}`);
      }
    }
  } catch (e) {
    console.log(`FAIL ${f}: ${e.message}`);
  }
}
