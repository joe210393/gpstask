#!/usr/bin/env node
const fs = require('fs');
const readline = require('readline');
const path = require('path');

const INPUT = path.join(__dirname, 'data', 'plants-forest-gov-tw-enriched-embed-dedup.taxonomy-v2.jsonl');

async function main() {
  const rl = readline.createInterface({
    input: fs.createReadStream(INPUT),
    crlfDelay: Infinity,
  });

  let total = 0;
  let hasTaxonomy = 0;
  let hasGenus = 0;
  let hasFamily = 0;
  let hasLifeForm = 0;
  let hasFlowering = 0;
  let hasAlias = 0;
  let genusValid = 0;
  let genusInvalid = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    total++;
    const obj = JSON.parse(line);
    
    if (obj.taxonomy && Object.keys(obj.taxonomy).length > 0) {
      hasTaxonomy++;
    }
    if (obj.taxonomy?.genus) {
      hasGenus++;
      const latin = obj.taxonomy.genus.latin || '';
      if (/^[A-Z][a-z-]{2,}$/.test(latin)) {
        genusValid++;
      } else {
        genusInvalid++;
        if (genusInvalid <= 5) {
          console.log(`⚠️  無效 genus: ${obj.chinese_name} -> "${latin}"`);
        }
      }
    }
    if (obj.taxonomy?.family) hasFamily++;
    if (obj.taxonomy?.life_form) hasLifeForm++;
    if (obj.taxonomy?.flowering_season) hasFlowering++;
    if (obj.taxonomy?.alias) hasAlias++;
  }

  console.log('📊 Taxonomy Enrichment 統計結果\n');
  console.log(`總筆數: ${total}`);
  console.log(`taxonomy 非空: ${hasTaxonomy} (${(hasTaxonomy / total * 100).toFixed(1)}%)`);
  console.log(`genus: ${hasGenus} (${(hasGenus / total * 100).toFixed(1)}%)`);
  console.log(`  └─ 有效格式: ${genusValid} (${genusInvalid > 0 ? '⚠️  有 ' + genusInvalid + ' 筆無效' : '✅ 全部有效'})`);
  console.log(`family: ${hasFamily} (${(hasFamily / total * 100).toFixed(1)}%)`);
  console.log(`life_form: ${hasLifeForm} (${(hasLifeForm / total * 100).toFixed(1)}%)`);
  console.log(`flowering_season: ${hasFlowering} (${(hasFlowering / total * 100).toFixed(1)}%)`);
  console.log(`alias: ${hasAlias} (${(hasAlias / total * 100).toFixed(1)}%)`);
  
  console.log(`\n🎯 目標達成度:`);
  console.log(`  taxonomy 非空率: ${(hasTaxonomy / total * 100).toFixed(1)}% (目標: 60%+) ${hasTaxonomy / total >= 0.6 ? '✅' : '❌'}`);
  console.log(`  genus 有效率: ${genusValid === hasGenus && hasGenus > 0 ? '✅ 100%' : '❌ ' + (genusValid / hasGenus * 100).toFixed(1) + '%'}`);
}

main().catch(console.error);
