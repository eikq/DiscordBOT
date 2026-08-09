export type SocialAction = 
    | 'IGNORE'
    | 'LISTEN'
    | 'SHORT_REACTION'
    | 'ANSWER'
    | 'JOKE'
    | 'ASK'
    | 'INTERRUPT'
    | 'CONTINUE_PREVIOUS_THOUGHT';

export interface SocialDecision {
    action: SocialAction;
    targetUserIds: string[];
    confidence: number;
    directlyAddressed: boolean;
    responseExpected: number;
    interruptAppropriate: boolean;
    desiredLength: 'very_short' | 'short' | 'medium' | 'long';
    tone: string;
    reasonCode: string;
}
