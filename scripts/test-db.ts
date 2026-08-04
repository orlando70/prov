/**
 * Standalone database connection and CRUD test.
 * Does NOT require Redis — only DATABASE_URL.
 *
 * Usage:  npx tsx scripts/test-db.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('\n🔌 Testing database connection...');
  await prisma.$connect();
  console.log('✅ Connected to database\n');

  // ── 1. Seed teams ────────────────────────────────────────────
  console.log('📦 Creating test teams...');
  const teamA = await prisma.team.create({
    data: { name: 'Manchester City', shortName: 'MCI' },
  });
  const teamB = await prisma.team.create({
    data: { name: 'Arsenal', shortName: 'ARS' },
  });
  console.log(`   Created: ${teamA.name} (${teamA.id})`);
  console.log(`   Created: ${teamB.name} (${teamB.id})`);

  // ── 2. Create a match ────────────────────────────────────────
  console.log('\n⚽ Creating test match...');
  const match = await prisma.match.create({
    data: {
      homeTeamId: teamA.id,
      awayTeamId: teamB.id,
    },
  });
  console.log(`   Match ${match.id} — status: ${match.status}`);

  // ── 3. Create statistics rows ────────────────────────────────
  console.log('\n📊 Creating match statistics...');
  await prisma.matchStatistic.createMany({
    data: [
      { matchId: match.id, teamId: teamA.id },
      { matchId: match.id, teamId: teamB.id },
    ],
  });
  console.log('   Statistics created for both teams');

  // ── 4. Insert a match event ──────────────────────────────────
  console.log('\n🎯 Inserting a GOAL event...');
  const event = await prisma.matchEvent.create({
    data: {
      matchId: match.id,
      minute: 23,
      type: 'GOAL',
      teamId: teamA.id,
      player: 'Haaland',
    },
  });
  console.log(`   Event ${event.id} — seq: ${event.seq}, type: ${event.type}`);

  // ── 5. Insert a chat message ─────────────────────────────────
  console.log('\n💬 Inserting a chat message...');
  const chatMsg = await prisma.chatMessage.create({
    data: {
      matchId: match.id,
      userId: 'user-001',
      username: 'FootballFan',
      message: 'What a goal!',
    },
  });
  console.log(`   Message ${chatMsg.id} — "${chatMsg.message}"`);

  // ── 6. Read back the full match ──────────────────────────────
  console.log('\n📖 Reading full match...');
  const fullMatch = await prisma.match.findUnique({
    where: { id: match.id },
    include: {
      homeTeam: true,
      awayTeam: true,
      events: { orderBy: { seq: 'asc' } },
      statistics: true,
      chatMessages: { orderBy: { createdAt: 'asc' } },
    },
  });
  console.log(`   ${fullMatch!.homeTeam.shortName} ${fullMatch!.homeScore} – ${fullMatch!.awayScore} ${fullMatch!.awayTeam.shortName}`);
  console.log(`   Events: ${fullMatch!.events.length}`);
  console.log(`   Chat messages: ${fullMatch!.chatMessages.length}`);

  // ── 7. List matches (GET /api/matches simulation) ────────────
  console.log('\n📋 Listing all matches...');
  const matches = await prisma.match.findMany({
    include: { homeTeam: true, awayTeam: true },
    orderBy: { createdAt: 'desc' },
  });
  console.log(`   Found ${matches.length} match(es)`);

  // ── 8. Cleanup ───────────────────────────────────────────────
  console.log('\n🧹 Cleaning up test data...');
  await prisma.chatMessage.deleteMany({ where: { matchId: match.id } });
  await prisma.matchEvent.deleteMany({ where: { matchId: match.id } });
  await prisma.matchStatistic.deleteMany({ where: { matchId: match.id } });
  await prisma.match.delete({ where: { id: match.id } });
  await prisma.team.deleteMany({ where: { id: { in: [teamA.id, teamB.id] } } });
  console.log('   Test data removed');

  console.log('\n✅ All database tests passed!\n');
}

main()
  .catch((err) => {
    console.error('\n❌ Test failed:', err.message ?? err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
