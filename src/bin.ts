import { version } from '../package.json'

import { Command } from 'commander';

const program = new Command();

program
	.version(version)
	.description('My custom command that accepts parameters')
	.option('-n, --name <name>', 'Your name')
	.option('-a, --age <age>', 'Your age');

program.parse(process.argv);

const options = program.opts();

if (options.name && options.age) {
	console.log(`Hello, ${options.name}! You are ${options.age} years old.`);
} else {
	console.log('Please provide both name and age.');
}
