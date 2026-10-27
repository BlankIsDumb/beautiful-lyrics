import { Timestamp, TimeStepped, SeekTo, Song } from "@Spices/Spicetify/Services/Player/mod.ts";

export interface LyricClock {
  now(): number;
  duration(): number;
  seek(seconds: number): void;
  subscribe(consume: (deltaTime: number, skipped?: true) => void): () => void;
}

// Consumer boundary only. Keep the inherited Spotify interpolation, local/Connect
// synchronization and pause behavior intact until transport demand is profiled.
export const PlayerLyricClock: LyricClock = {
  now: () => Timestamp,
  duration: () => Song && Song.Type !== "DJ" ? Song.Duration : 0,
  seek: SeekTo,
  subscribe: consume => {
    const connection = TimeStepped.Connect(consume);
    return () => connection.Disconnect();
  },
};
