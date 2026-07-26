// Zentrale Spielkonstanten. Alles, was Physik, Bauen und KI gemeinsam brauchen,
// steht hier, damit die Module nicht auseinanderlaufen.

// --- Simulation ---
export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;
export const MAX_TICKS_PER_FRAME = 5; // gegen die Todesspirale nach einem Tab-Wechsel

// --- Welt ---
export const GRAVITY = 26;
export const ARENA_HALF = 32; // Arena ist 64 x 64 Einheiten
export const CELL = 3; // Kantenlänge einer Bauzelle

// --- Spieler ---
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_RADIUS = 0.4;
export const EYE_HEIGHT = 1.62;
export const WALK_SPEED = 7.0;
export const SPRINT_SPEED = 10.5;
export const ADS_SPEED = 4.0;
export const JUMP_SPEED = 9.0;
// Wie schnell sich die Geschwindigkeit der Wunschrichtung annähert (1/s).
// Deckt Beschleunigung und Bremsen in einem Wert ab: steht die Wunschrichtung
// auf null, läuft dieselbe Annäherung als Reibung rückwärts.
export const GROUND_RESPONSE = 15;
export const AIR_RESPONSE = 3.4;
// Muss über der Rampen-Stufenhöhe (CELL / RAMP_STEPS) liegen, sonst bleibt man
// beim Hochlaufen an der Rampe hängen.
export const STEP_HEIGHT = 0.62;

export const MAX_HEALTH = 100;

// --- Bauen ---
export const RAMP_STEPS = 6; // Rampe = 6 gestapelte Kästen -> Kollision bleibt reine AABB
export const WALL_THICKNESS = 0.35;
export const WALL_HP = 150;
export const RAMP_HP = 120;
export const BUILD_COOLDOWN = 0.16;
export const BUILD_RANGE = CELL * 1.35;
export const MAX_PIECES = 220; // ältestes Teil verschwindet, hält die Framerate stabil

// --- Kamera / Zielen ---
export const FOV = 78;
export const ADS_FOV = 52;
export const LOOK_PITCH_LIMIT = Math.PI / 2 - 0.02;

// --- Match ---
export const ROUNDS_TO_WIN = 3;
export const ROUND_INTERMISSION = 2.6;

export const TEAM_PLAYER = 'player';
export const TEAM_BOT = 'bot';
