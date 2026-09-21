import * as ts from 'typescript';
import type { Plugin } from 'vite';

/**
 * Developer-only Vite transform for the food-performance A/B runs.
 * The transform is opt-in: importing/calling profilePlugin() is the only activation switch.
 * It has no dependency on the simulation profiler and writes no canonical state.
 */
const TARGETS: Record<string, readonly string[]> = {
  'mind/agent.ts': ['Simulation.perceiveFromBody', 'Simulation.maybeChat', 'Simulation.tell', 'Simulation.think', 'Simulation.strategic'],
  'core/world.ts': ['World.emit', 'World.compactEvents'],
  'core/spatial.ts': ['SpatialIndex.query'],
  'physical/grid.ts': ['VoxelGrid.lineOfSight'],
  'physical/nav.ts': ['Navigator.findPath'],
  'mind/encounter.ts': ['recognizeEncounter', 'visibleCues', 'appearanceSignature'],
  'mind/knowledge.ts': ['learn', 'pruneKnowledge'],
  'mind/knowledgeView.ts': ['knowledgeItems'],
  'mind/records.ts': ['knowsNotation', 'recordGoals'],
  'mind/economy.ts': ['laborIncentive'],
  'mind/genealogy.ts': ['inferGenealogy', 'genealogyGoals'],
  'mind/memory.ts': ['remember'],
  'mind/people.ts': ['interpretSocial'],
  'social/appraisal.ts': ['appraiseClaim'],
  'runtime/agencyInspection.ts': ['inspectAgency'],
  'mind/conversation.ts': ['selectTopic'],
  'mind/relationships.ts': ['adjustRel'],
  'mind/pursuit.ts': ['motivationBoost'],
  'mind/socialEvidence.ts': ['socialEvidence'],
  'core/capability.ts': ['recordCapabilityPractice'],
  'world/labor.ts': ['runTradeBatch'],
  'logistics/participation.ts': ['progressHaul'],
  'logistics/haul.ts': ['maintainHauls', 'generateLogisticsNeeds'],
};

export const profileLabels = Object.freeze([...Object.values(TARGETS).flat(), 'goalCandidate', 'knowledge.prune.entries', 'memory.prune.entries']);

function hook(name: 'enter' | 'leave', label: string): ts.ExpressionStatement {
  const profiler = ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('globalThis'), '__foodProfile');
  const access = ts.factory.createPropertyAccessChain(
    profiler,
    ts.factory.createToken(ts.SyntaxKind.QuestionDotToken),
    ts.factory.createIdentifier(name),
  );
  return ts.factory.createExpressionStatement(ts.factory.createCallChain(access, ts.factory.createToken(ts.SyntaxKind.QuestionDotToken), undefined, [ts.factory.createStringLiteral(label)]));
}

function work(label: string, amount: ts.Expression): ts.ExpressionStatement {
  const profiler = ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('globalThis'), '__foodProfile');
  const access = ts.factory.createPropertyAccessChain(profiler, ts.factory.createToken(ts.SyntaxKind.QuestionDotToken), ts.factory.createIdentifier('work'));
  return ts.factory.createExpressionStatement(ts.factory.createCallChain(access, ts.factory.createToken(ts.SyntaxKind.QuestionDotToken), undefined, [ts.factory.createStringLiteral(label), amount]));
}

function withWork(body: ts.Block, functionNameText: string): ts.Block {
  const statements = [...body.statements];
  if (functionNameText === 'think') {
    const index = statements.findIndex(s => ts.isVariableStatement(s) && s.declarationList.declarations.some(d => ts.isIdentifier(d.name) && d.name.text === 'G'));
    if (index >= 0) {
      const declaration = statements[index] as ts.VariableStatement;
      const declarations = declaration.declarationList.declarations.map(d => {
        if (!ts.isIdentifier(d.name) || d.name.text !== 'G' || !d.initializer || !ts.isArrowFunction(d.initializer) || !ts.isBlock(d.initializer.body)) return d;
        const arrowBody = ts.factory.updateBlock(d.initializer.body, [...d.initializer.body.statements, work('goalCandidate', ts.factory.createNumericLiteral(1))]);
        const arrow = ts.factory.updateArrowFunction(d.initializer, d.initializer.modifiers, d.initializer.typeParameters, d.initializer.parameters, d.initializer.type, d.initializer.equalsGreaterThanToken, arrowBody);
        return ts.factory.updateVariableDeclaration(d, d.name, d.exclamationToken, d.type, arrow);
      });
      statements[index] = ts.factory.updateVariableStatement(declaration, declaration.modifiers, ts.factory.updateVariableDeclarationList(declaration.declarationList, declarations));
    }
  } else if (functionNameText === 'pruneKnowledge') {
    const index = statements.findIndex(s => ts.isExpressionStatement(s) && (s.getText().includes('ranked.sort') || s.getText().includes('keys.sort')));
    if (index >= 0) {
      const sortedName = statements[index].getText().includes('keys.sort') ? 'keys' : 'ranked';
      statements.splice(index + 1, 0, work('knowledge.prune.entries', ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier(sortedName), 'length')));
    }
  } else if (functionNameText === 'remember') {
    const index = statements.findIndex(s => ts.isIfStatement(s) && s.getText().includes('p.memories.length > MAX_MEMORIES'));
    if (index >= 0) {
      const condition = statements[index] as ts.IfStatement;
      const thenBlock = ts.isBlock(condition.thenStatement) ? condition.thenStatement : ts.factory.createBlock([condition.thenStatement], true);
      const updated = ts.factory.updateIfStatement(condition, condition.expression,
        ts.factory.updateBlock(thenBlock, [work('memory.prune.entries', ts.factory.createPropertyAccessExpression(ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('p'), 'memories'), 'length')), ...thenBlock.statements]), condition.elseStatement);
      statements[index] = updated;
    }
  }
  return ts.factory.updateBlock(body, statements);
}

function wrap(body: ts.Block, label: string): ts.Block {
  const original = [...body.statements];
  const guarded = ts.factory.createTryStatement(
    ts.factory.createBlock(original, true),
    undefined,
    ts.factory.createBlock([hook('leave', label)], true),
  );
  return ts.factory.createBlock([hook('enter', label), guarded], true);
}

function functionName(node: ts.FunctionDeclaration | ts.MethodDeclaration): string | undefined {
  return node.name && ts.isIdentifier(node.name) ? node.name.text : undefined;
}

function keyFor(relative: string, className: string | undefined, name: string): string | undefined {
  const candidates = TARGETS[relative] ?? [];
  const key = className ? `${className}.${name}` : name;
  return candidates.includes(key) ? key : candidates.includes(name) ? name : undefined;
}

export function profilePlugin(): Plugin {
  return {
    name: 'food-performance-profile-instrumentation',
    enforce: 'pre',
    transform(code, id) {
      const clean = id.split('?')[0].replaceAll('\\', '/');
      const marker = '/src/sim/';
      const at = clean.lastIndexOf(marker);
      if (at < 0 || !clean.endsWith('.ts')) return null;
      const relative = clean.slice(at + marker.length);
      const slash = relative.lastIndexOf('/');
      const targetFile = slash >= 0 ? relative.slice(0, slash + 1) + relative.slice(slash + 1) : relative;
      const candidates = TARGETS[targetFile];
      if (!candidates) return null;
      const source = ts.createSourceFile(clean, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      let currentClass: string | undefined;
      let changed = false;
      const visit: ts.Visitor = node => {
        if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
          const prior = currentClass;
          currentClass = node.name?.text;
          const result = ts.visitEachChild(node, visit, context);
          currentClass = prior;
          return result;
        }
        if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
          const name = functionName(node);
          const label = name ? keyFor(targetFile, ts.isMethodDeclaration(node) ? currentClass : undefined, name) : undefined;
          if (label && node.body && ts.isBlock(node.body)) {
            changed = true;
            const prepared = withWork(node.body, name);
            const body = wrap(prepared, label);
            return ts.isFunctionDeclaration(node)
              ? ts.factory.updateFunctionDeclaration(node, node.modifiers, node.asteriskToken, node.name, node.typeParameters, node.parameters, node.type, body)
              : ts.factory.updateMethodDeclaration(node, node.modifiers, node.asteriskToken, node.name, node.questionToken, node.typeParameters, node.parameters, node.type, body);
          }
        }
        if (relative === 'mind/agent.ts' && ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
          && node.name.text === 'G' && node.initializer && ts.isArrowFunction(node.initializer) && ts.isBlock(node.initializer.body)) {
          const body = ts.factory.updateBlock(node.initializer.body, [...node.initializer.body.statements, work('goalCandidate', ts.factory.createNumericLiteral(1))]);
          const arrow = ts.factory.updateArrowFunction(node.initializer, node.initializer.modifiers, node.initializer.typeParameters, node.initializer.parameters, node.initializer.type, node.initializer.equalsGreaterThanToken, body);
          changed = true;
          return ts.factory.updateVariableDeclaration(node, node.name, node.exclamationToken, node.type, arrow);
        }
        return ts.visitEachChild(node, visit, context);
      };
      let context!: ts.TransformationContext;
      const result = ts.transform(source, [ctx => { context = ctx; return root => ts.visitNode(root, visit) as ts.SourceFile; }]);
      if (!changed) { result.dispose(); return null; }
      const output = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(result.transformed[0] as ts.SourceFile);
      result.dispose();
      return { code: output, map: null };
    },
  };
}

export function describeProfileLabels(): readonly string[] { return profileLabels; }
