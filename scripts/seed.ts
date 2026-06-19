import { seedDatabase } from '../src/lib/repository';

seedDatabase()
  .then(() => {
    console.log('Seed data loaded');
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
