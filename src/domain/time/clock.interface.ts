export interface IClock {
  now(): Date;
}

export const systemClock: IClock = {
  now: () => new Date(),
};
