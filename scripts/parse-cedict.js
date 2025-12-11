const fs = require('fs');
const zlib = require('zlib');

// Parse CC-CEDICT format: Traditional Simplified [pinyin] /def1/def2/
function parseCedictLine(line) {
  if (!line || line.trim() === '' || line.startsWith('#')) {
    return null;
  }

  // Match: Traditional Simplified [pinyin] /definitions/
  // The format is: trad simp [pinyin] /def1/def2/ (may or may not end with /)
  // Use a more flexible regex that doesn't require trailing /
  const match = line.match(/^(.+?)\s+(.+?)\s+\[(.+?)\]\s+\/(.+?)(?:\/)?\s*$/);
  if (!match) {
    return null;
  }

  const [, traditional, simplified, pinyin, definitions] = match;
  
  // Split definitions by / and filter empty strings
  const defArray = definitions.split('/')
    .map(d => d.trim())
    .filter(d => d.length > 0);

  // If no definitions found, use the whole string
  if (defArray.length === 0) {
    defArray.push(definitions.trim());
  }

  return {
    traditional: traditional.trim(),
    simplified: simplified.trim(),
    pinyin: pinyin.trim(),
    definitions: defArray
  };
}

// Read and parse the CC-CEDICT file
function parseCedict(inputFile, outputFile) {
  console.log('Reading CC-CEDICT file...');
  
  // Read the entire file
  const compressed = fs.readFileSync(inputFile);
  const decompressed = zlib.gunzipSync(compressed);
  const content = decompressed.toString('utf-8');
  
  console.log('Parsing entries...');
  const lines = content.split('\n');
  const dictionary = [];
  
  let count = 0;
  let skipped = 0;
  for (const line of lines) {
    const entry = parseCedictLine(line);
    if (entry) {
      dictionary.push(entry);
      count++;
      if (count % 10000 === 0) {
        console.log(`Parsed ${count} entries...`);
      }
    } else if (line.trim() && !line.startsWith('#')) {
      skipped++;
      if (skipped <= 5) {
        console.log(`Skipped line: ${line.substring(0, 80)}...`);
      }
    }
  }
  if (skipped > 0) {
    console.log(`Skipped ${skipped} lines that didn't match format`);
  }

  console.log(`Parsed ${dictionary.length} entries`);
  
  // Create index for faster lookups
  const index = {
    bySimplified: {},
    byTraditional: {},
    byPinyin: {}
  };

  console.log('Creating indexes...');
  dictionary.forEach(entry => {
    // Index by simplified
    if (!index.bySimplified[entry.simplified]) {
      index.bySimplified[entry.simplified] = [];
    }
    index.bySimplified[entry.simplified].push(entry);

    // Index by traditional (if different)
    if (entry.traditional !== entry.simplified) {
      if (!index.byTraditional[entry.traditional]) {
        index.byTraditional[entry.traditional] = [];
      }
      index.byTraditional[entry.traditional].push(entry);
    }

    // Index by pinyin (first syllable for partial matches)
    const firstPinyin = entry.pinyin.split(' ')[0];
    if (!index.byPinyin[firstPinyin]) {
      index.byPinyin[firstPinyin] = [];
    }
    index.byPinyin[firstPinyin].push(entry);
  });

  const output = {
    entries: dictionary,
    index: index,
    totalEntries: dictionary.length
  };

  console.log('Writing JSON file...');
  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
  console.log(`Saved to ${outputFile}`);
  console.log(`Indexed ${Object.keys(index.bySimplified).length} simplified characters`);
  console.log(`Indexed ${Object.keys(index.byTraditional).length} traditional characters`);
}

// Run the parser
const inputFile = process.argv[2] || 'cedict_ts.u8.gz';
const outputFile = process.argv[3] || 'src/assets/cedict.json';

parseCedict(inputFile, outputFile);

