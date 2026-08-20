export type EvolutionNodeKind =
  | 'person'
  | 'experience'
  | 'memory'
  | 'skill'
  | 'project'
  | 'failure'
  | 'reflection'
  | 'goal'
  | 'knowledge';

export type EvolutionEdgeKind =
  | 'experience_to_reflection'
  | 'reflection_to_lesson'
  | 'lesson_to_skill'
  | 'skill_to_task'
  | 'failure_to_approach'
  | 'person_to_interaction'
  | 'research_to_knowledge'
  | 'goal_to_practice';

export type EvolutionNode = {
  id: string;
  kind: EvolutionNodeKind;
  label: string;
};

export type EvolutionEdge = {
  id: string;
  source: string;
  target: string;
  kind: EvolutionEdgeKind;
};

export type EvolutionGraph = {
  nodes: EvolutionNode[];
  edges: EvolutionEdge[];
  truncated: boolean;
};

const NODE_CAP = 80;
const EDGE_CAP = 120;

export function buildEvolutionGraph(input: {
  experiences: Array<{ id: string; goal: string; outcome: string }>;
  reflections: Array<{ experienceId: string; reusableLesson: string }>;
  skills: Array<{ skillId: string; version: number; purpose: string; evidence?: string[] }>;
  goals?: Array<{ id: string; title: string }>;
  failures?: Array<{ signature: string }>;
}): EvolutionGraph {
  const nodes = new Map<string, EvolutionNode>();
  const edges: EvolutionEdge[] = [];
  const addNode = (node: EvolutionNode) => {
    if (nodes.size >= NODE_CAP && !nodes.has(node.id)) return;
    nodes.set(node.id, node);
  };
  const addEdge = (edge: EvolutionEdge) => {
    if (edges.length >= EDGE_CAP) return;
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) return;
    edges.push(edge);
  };

  for (const experience of input.experiences) {
    addNode({ id: experience.id, kind: 'experience', label: experience.goal.slice(0, 48) });
  }
  for (const reflection of input.reflections) {
    const id = `ref_${reflection.experienceId}`;
    addNode({ id, kind: 'reflection', label: reflection.reusableLesson.slice(0, 48) });
    addEdge({
      id: `e_${reflection.experienceId}_ref`,
      source: reflection.experienceId,
      target: id,
      kind: 'experience_to_reflection',
    });
    if (reflection.reusableLesson) {
      const lessonId = `les_${reflection.experienceId}`;
      addNode({ id: lessonId, kind: 'knowledge', label: reflection.reusableLesson.slice(0, 48) });
      addEdge({
        id: `e_${id}_les`,
        source: id,
        target: lessonId,
        kind: 'reflection_to_lesson',
      });
    }
  }
  for (const skill of input.skills) {
    const id = `skill_${skill.skillId}_v${skill.version}`;
    addNode({ id, kind: 'skill', label: `${skill.skillId} v${skill.version}` });
    for (const evidence of skill.evidence ?? []) {
      const lessonId = `les_${evidence}`;
      if (nodes.has(lessonId)) {
        addEdge({
          id: `e_${lessonId}_${id}`,
          source: lessonId,
          target: id,
          kind: 'lesson_to_skill',
        });
      }
    }
  }
  for (const goal of input.goals ?? []) {
    addNode({ id: goal.id, kind: 'goal', label: goal.title.slice(0, 48) });
  }
  for (const failure of input.failures ?? []) {
    addNode({ id: `fail_${failure.signature.slice(0, 24)}`, kind: 'failure', label: failure.signature.slice(0, 48) });
  }
  return {
    nodes: [...nodes.values()],
    edges,
    truncated: input.experiences.length + input.skills.length > NODE_CAP,
  };
}
