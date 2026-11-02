# Rollercoaster

Ride the coaster over eight hills without stalling or flying off the rails.

## How to play

- The car starts rolling on its own. Hold the mouse button, or the space bar, to
  fire the launch motor and speed up. Let go to coast.
- Gravity slows the car on the way up a hill and speeds it up on the way down.
- If the car runs out of speed before a crest, it stalls and the ride ends.
- If the car goes over a crest faster than 320 px/s, it leaves the track and the
  ride ends. The white mark on the speed gauge shows that limit, and the gauge
  turns red past it.
- Click again on the game over screen to ride again.

## Scoring

- Each crest you go over safely scores 1 point for every 10 px/s of speed at the
  top, rounded. A crest at 300 px/s scores 30.
- Reaching the end of the track adds a 50 point bonus.
- A stall or a derailment keeps the points you scored before it.

Your final score is saved to the carnival's score board when the ride ends.

## Files

- `game.ts`: the game logic (`createState`, `setBoost`, `step`, `trackHeight`,
  `trackSlope`, `scoreForCrest`) and the `rollercoaster` entry, the default
  export the midway finds.
- `game.test.ts`: tests for the game logic.
