#!/usr/bin/env node
/**
 * Fixture CLI entry point for ADW behavioral testing.
 * Parses command-line arguments and prints usage or a greeting.
 */

const args = process.argv.slice(2);

function printHelp(): void {
  console.log('Usage: cli [--help] [--version] <name>');
  console.log('');
  console.log('Options:');
  console.log('  --help     Show this help message');
  console.log('  --version  Show version number');
}

function main(): void {
  if (args.includes('--help') || args.length === 0) {
    printHelp();
    return;
  }
  if (args.includes('--version')) {
    console.log('1.0.0');
    return;
  }
  const name = args[0] ?? 'World';
  console.log(`Hello, ${name}!`);
}

main();
