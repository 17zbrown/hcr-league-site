/**
 * Typeahead hints per class, drawn from what the grid actually runs.
 *
 * Deliberately suggestions and not a fixed list: iRacing releases cars mid-season,
 * and a hardcoded dropdown would turn a legal entry into an impossible one. Shared
 * by the season entry form and the team application so a driver is offered the same
 * cars whichever door they came in through.
 */
export const CAR_SUGGESTIONS: Record<string, string[]> = {
  GTP: ['Acura ARX-06', 'Cadillac V-Series.R', 'Porsche 963', 'BMW M Hybrid V8', 'Ferrari 499P'],
  LMP2: ['Dallara P217'],
  GTD: [
    'Ferrari 296 GT3', 'Porsche 911 GT3 R (992)', 'Chevrolet Corvette Z06 GT3.R',
    'Lamborghini Huracan GT3 EVO', 'McLaren 720S GT3 EVO', 'Mercedes-AMG GT3 2020',
    'Audi R8 LMS GT3', 'BMW M4 GT3', 'Aston Martin Vantage GT3 EVO', 'Ford Mustang GT3',
  ],
}
