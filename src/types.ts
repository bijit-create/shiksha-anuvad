export type GradeLevel =
  | 'KG' | 'Grade 1' | 'Grade 2' | 'Grade 3' | 'Grade 4'
  | 'Grade 5' | 'Grade 6' | 'Grade 7' | 'Grade 8'
  | 'Grade 9' | 'Grade 10' | 'Grade 11' | 'Grade 12';

export type Subject =
  | 'Mathematics' | 'Science' | 'Social Science' | 'English'
  | 'Environmental Studies' | 'Physics' | 'Chemistry' | 'Biology'
  | 'History' | 'Geography' | 'Economics' | 'Political Science';

export type Language =
  | 'Hindi' | 'Marathi' | 'Gujarati' | 'Odia' | 'Telugu'
  | 'Bengali' | 'Tamil' | 'Kannada' | 'Malayalam'
  | 'Punjabi' | 'Urdu' | 'Assamese' | 'Sanskrit';

export interface TranslationRequest {
  content: string;
  grade?: GradeLevel | string;
  subject?: Subject | string;
  contentType?: string;
  additionalContext?: string;
  targetLanguage?: Language | string;
}

export interface TranslationResponse {
  translatedText: string;
  explanation?: string;
}

export interface ContentAnalysis {
  keyConcepts: string[];
  vocabulary: { english: string; hindi: string; definition: string }[];
  ncertAlignment: string;
  suggestedActivities?: string[];
}
