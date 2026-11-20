import { Timestamp, TimeStepped, SeekTo, Song } from "@Spices/Spicetify/Services/Player/mod.ts";

export interface LyricClock {
  now(): number;
  duration(): number;
  seek(seconds: number): void;
  subscribe(consume: (deltaTime: number, skipped?: true) => void): () => void;
}

// Subscriptions keep Spotify's clock running during playback or watching for
// paused seeks. With no consumers, the player stops its frame and sync work.
export const PlayerLyricClock: LyricClock = {
  now: () => Timestamp,
  duration: () => Song && Song.Type !== "DJ" ? Song.Duration : 0,
  seek: SeekTo,
  subscribe: consume => {
    const connection = TimeStepped.Connect(consume);
    return () => connection.Disconnect();
  },
};
