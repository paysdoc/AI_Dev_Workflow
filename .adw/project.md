# ADW Project Configuration

## Project Overview
AI Dev Workflow (ADW) is a TypeScript/Node.js project that automates software development by integrating GitHub issues with Claude Code CLI. It uses Next.js for the web interface, and the `adws/` directory contains the workflow automation scripts.

## Relevant Files
- `README.md` - Contains the project overview and instructions.
- `guidelines/**` - Contains coding guidelines that must be followed (target repository — may not exist in all repos). If present, read and follow these guidelines.
- `src/app/**` - Contains Next.js App Router pages, layouts, and route handlers.
- `src/components/**` - Contains React components.
- `src/lib/**` - Contains utility functions and shared logic.
- `src/hooks/**` - Contains custom React hooks.
- `src/styles/**` - Contains global styles and CSS modules.
- `public/**` - Contains static assets.
- `adws/**` - Contains the AI Developer Workflow (ADW) scripts.

## Framework Notes
This is a Next.js App Router project using React and TypeScript. Use server components by default. The `adws/` directory contains standalone TypeScript scripts that run with `npx tsx` and are separate from the Next.js application.

## Library Install Command
npm install

## Script Execution
npx tsx <script_name>
