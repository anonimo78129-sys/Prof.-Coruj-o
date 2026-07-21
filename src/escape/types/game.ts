export interface MCQuestion {
  text: string;
  options: [string, string, string, string];
  correct: 0 | 1 | 2 | 3;
}

export interface MatchPair {
  concept: string;
  definition: string;
}

export interface NarrativeOption {
  label: string;
  karma: 'luz' | 'sombra';
  reaction: string;
}

export interface NarrativeChoice {
  prompt: string;
  options: [NarrativeOption, NarrativeOption];
}

export interface GameStory {
  intro: string[];
  hook: string;
}

export interface GameConfig {
  id: string;
  subject: string;
  level?: string;
  createdAt: number;
  story?: GameStory;
  scenes: {
    forest: { questions: MCQuestion[]; narrative: NarrativeChoice };
    city: { pairs: MatchPair[]; narrative: NarrativeChoice };
    caves: { questions: MCQuestion[]; narrative: NarrativeChoice };
    tower: { questions: MCQuestion[] };
  };
  assets: {
    forest?: string;
    city?: string;
    caves?: string;
    tower?: string;
    iris?: string;
    tree?: string;
    cog?: string;
    celene?: string;
    guardian?: string;
    fragEsmeralda?: string;
    fragAmbar?: string;
    fragSafira?: string;
  };
}

export interface EnemyDef {
  id: string;
  name: string;
  title: string;
  sprite: string;
  maxHp: number;
  size: number;
  color: string;
  taunt: string;
  attackMsg: string;
  isBoss?: boolean;
}

export type PhaseKind = 'forest' | 'city' | 'caves' | 'battle';

export interface PhaseDef {
  id: string;
  kind: PhaseKind;
  title: string;
  subtitle: string;
  icon: string;
  bg?: string;
  enemyId?: string;
  reward?: FragmentName;
  questionBank?: 'forest' | 'caves' | 'tower';
}

export interface PhaseProgress {
  completed: boolean;
  stars: number;
  coins: number;
}

export type SceneName = 'intro' | 'transition' | 'forest' | 'city' | 'caves' | 'tower' | 'victory';
export type KarmaChoice = 'luz' | 'sombra';
export type FragmentName = 'esmeralda' | 'ambar' | 'safira';
export type EndingName = 'heroi' | 'sabio' | 'explorador' | 'mestre';

export interface ForestState {
  found: [boolean, boolean, boolean];
  passed: [boolean, boolean, boolean];
  narrativeDone: boolean;
}

export interface CityState {
  connected: boolean[];
  narrativeDone: boolean;
}

export interface CavesState {
  index: number;
  lit: boolean[];
  narrativeDone: boolean;
}

export interface TowerState {
  filled: [boolean, boolean, boolean];
  currentSlot: number;
}

export interface GameScore {
  firstTry: number;
  total: number;
  timeSeconds: number;
}

export interface KarmaState {
  choices: KarmaChoice[];
  ending: EndingName | null;
}

export interface GameState {
  config: GameConfig;
  scene: SceneName;
  nextScene: SceneName | null;
  hearts: number;
  fragments: FragmentName[];
  score: GameScore;
  karma: KarmaState;
  forest: ForestState;
  city: CityState;
  caves: CavesState;
  tower: TowerState;
  transitionText: string[];
  activeQuestion: { question: MCQuestion; onAnswer: (idx: number) => void } | null;
  activeNarrative: NarrativeChoice | null;
}
