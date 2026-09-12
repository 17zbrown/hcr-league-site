/**
 * The cars the league's iRacing session actually allows — read off the league
 * session's car list (one LMP2, six GTP, ten GT3) and spelled the way the grid
 * already stores them, so an existing entry always matches a dropdown option. The
 * Aston Martin Valkyrie is on the league list ahead of the iRacing session — add it
 * to each race's car list there before someone turns up in one.
 *
 * This is the source for the car dropdowns on the Signups and Grid tabs and the
 * season entry form. Every dropdown still preserves whatever value an entry already
 * holds and offers "Other…", so a car iRacing adds mid-season is a typed value, not
 * a blocked one — but the day it is added to the league session, add it here too.
 */
export const CAR_SUGGESTIONS: Record<string, string[]> = {
  GTP: [
    'Acura ARX-06',
    'Aston Martin Valkyrie AMR-LMH',
    'BMW M Hybrid V8',
    'Cadillac V-Series.R',
    'Ferrari 499P',
    'Porsche 963',
  ],
  LMP2: ['Dallara P217'],
  GTD: [
    'Acura NSX GT3 EVO 22',
    'Aston Martin Vantage GT3 EVO',
    'BMW M4 GT3 EVO',
    'Chevrolet Corvette Z06 GT3.R',
    'Ferrari 296 GT3',
    'Ford Mustang GT3',
    'Lamborghini Huracan GT3 EVO',
    'McLaren 720S GT3 EVO',
    'Mercedes-AMG GT3 2020',
    'Porsche 911 GT3 R (992)',
  ],
}
