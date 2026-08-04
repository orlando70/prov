import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

// Use DIRECT_URL (session-mode, no pgBouncer) for seed scripts
const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const TEAMS = [
  { name: 'Manchester City', shortName: 'MCI' },
  { name: 'Arsenal', shortName: 'ARS' },
  { name: 'Liverpool', shortName: 'LIV' },
  { name: 'Chelsea', shortName: 'CHE' },
  { name: 'Manchester United', shortName: 'MUN' },
  { name: 'Tottenham Hotspur', shortName: 'TOT' },
  { name: 'Newcastle United', shortName: 'NEW' },
  { name: 'Aston Villa', shortName: 'AVL' },
];

async function main() {
  console.log('Seeding database...\n');

  // Create teams
  const createdTeams = [];
  for (const team of TEAMS) {
    const t = await prisma.team.create({ data: team });
    createdTeams.push(t);
    console.log(`  ⚽ Created team: ${t.name} (${t.shortName})`);
  }

  // Create 4 matches (SIM_MATCH_COUNT default)
  const matchups = [
    [0, 1], // MCI vs ARS
    [2, 3], // LIV vs CHE
    [4, 5], // MUN vs TOT
    [6, 7], // NEW vs AVL
  ];

  for (const [homeIdx, awayIdx] of matchups) {
    const home = createdTeams[homeIdx];
    const away = createdTeams[awayIdx];

    const match = await prisma.match.create({
      data: {
        homeTeamId: home.id,
        awayTeamId: away.id,
      },
    });

    // Create initial statistics rows for both teams
    await prisma.matchStatistic.createMany({
      data: [
        { matchId: match.id, teamId: home.id },
        { matchId: match.id, teamId: away.id },
      ],
    });

    console.log(`  🏟️  Created match: ${home.shortName} vs ${away.shortName} (${match.id})`);
  }

  console.log('\n✅ Database seeded successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

