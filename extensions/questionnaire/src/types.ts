export interface QuestionOption {
  value: string;
  label: string;
  description?: string;
}

export interface QuestionRecommendation {
  value?: string;
  label?: string;
  reason: string;
}

export interface Question {
  id: string;
  label: string;
  prompt: string;
  options: QuestionOption[];
  allowOther: boolean;
  recommendation?: QuestionRecommendation;
}

export interface Answer {
  id: string;
  value: string;
  label: string;
  wasCustom: boolean;
  index?: number;
}

export interface QuestionnaireResult {
  questions: Question[];
  answers: Answer[];
  answersById: Record<string, Answer>;
  cancelled: boolean;
}
