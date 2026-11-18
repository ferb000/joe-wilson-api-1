import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';

const prisma = new PrismaClient();
// Snapshot of the existing frontend roster. New records are drafts; existing edits
// are preserved. This is an optional, explicitly run import, not an app startup task.
const roster = [
  {
    "name": "MOGmusic",
    "region": "Africa",
    "country": "Ghana",
    "genre": "Gospel",
    "projects": [
      {
        "title": "Holy Chant",
        "role": "Bass guitar",
        "youtubeId": "WMbSq-QrBVU"
      },
      {
        "title": "Amen",
        "role": "Bass guitar · Producer · Mix engineer",
        "youtubeId": "DaGu8IVbdbM"
      }
    ]
  },
  {
    "name": "Joe Mettle",
    "region": "Africa",
    "country": "Ghana",
    "genre": "Gospel",
    "projects": [
      {
        "title": "Thank You",
        "role": "Project manager",
        "youtubeId": "W3eA5eATBGw"
      },
      {
        "title": "African Medley",
        "role": "Mixing & mastering",
        "youtubeId": "2AaCWCufisg"
      }
    ]
  },
  {
    "name": "Diana Hamilton",
    "region": "Africa",
    "country": "Ghana",
    "genre": "Gospel",
    "projects": [
      {
        "title": "Old School Mashup",
        "role": "Producer · Mixing · Mastering",
        "youtubeId": "CVLX3GN6Y2E"
      },
      {
        "title": "Praise Medley",
        "role": "Mixing & mastering",
        "youtubeId": "hqkKCjdfbgo"
      }
    ]
  },
  {
    "name": "Nii Okai",
    "region": "Africa",
    "country": "Ghana",
    "genre": "Gospel",
    "projects": []
  },
  {
    "name": "Koda",
    "region": "Africa",
    "country": "Ghana",
    "genre": "Gospel",
    "projects": []
  },
  {
    "name": "Daniel Twum",
    "region": "Africa",
    "country": "Ghana",
    "genre": "Gospel",
    "projects": []
  },
  {
    "name": "Elder Mireku",
    "region": "Africa",
    "country": "Ghana",
    "genre": "Gospel",
    "projects": []
  },
  {
    "name": "Daughters of Glorious Jesus",
    "region": "Africa",
    "country": "Ghana",
    "genre": "Gospel",
    "projects": []
  },
  {
    "name": "Cwesi Oteng",
    "region": "Africa",
    "country": "Ghana",
    "genre": "Gospel",
    "projects": []
  },
  {
    "name": "Siisi Baidoo",
    "region": "Africa",
    "country": "Ghana",
    "genre": "Gospel",
    "projects": []
  },
  {
    "name": "Cecy Twum",
    "region": "Africa",
    "country": "Ghana",
    "genre": "Gospel",
    "projects": []
  },
  {
    "name": "Mary Ghansah",
    "region": "Africa",
    "country": "Ghana",
    "genre": "Gospel",
    "projects": []
  },
  {
    "name": "Nathaniel Bassey",
    "region": "Africa",
    "country": "Nigeria",
    "genre": "Gospel",
    "projects": []
  },
  {
    "name": "Dunsin Oyekan",
    "region": "Africa",
    "country": "Nigeria",
    "genre": "Gospel",
    "projects": []
  },
  {
    "name": "Preye Odede",
    "region": "Africa",
    "country": "Nigeria",
    "genre": "Gospel",
    "projects": []
  },
  {
    "name": "Sammy Okposo",
    "region": "Africa",
    "country": "Nigeria",
    "genre": "Gospel",
    "projects": []
  },
  {
    "name": "Evans Ogboi",
    "region": "United Kingdom",
    "country": "United Kingdom",
    "genre": "Gospel",
    "projects": []
  },
  {
    "name": "Emmanuel Smith",
    "region": "United Kingdom",
    "country": "United Kingdom",
    "genre": "Gospel",
    "projects": []
  },
  {
    "name": "Lou Fellingham",
    "region": "United Kingdom",
    "country": "United Kingdom",
    "genre": "Gospel",
    "projects": []
  },
  {
    "name": "Noel Robinson",
    "region": "United Kingdom",
    "country": "United Kingdom",
    "genre": "Gospel",
    "projects": []
  },
  {
    "name": "Checko Ankrah",
    "region": "United Kingdom",
    "country": "United Kingdom",
    "genre": "Gospel",
    "projects": []
  },
  {
    "name": "Sarah Tiebo",
    "region": "United Kingdom",
    "country": "United Kingdom",
    "genre": "Gospel",
    "projects": []
  },
  {
    "name": "Shekinah",
    "region": "United Kingdom",
    "country": "United Kingdom",
    "genre": "Gospel",
    "projects": []
  },
  {
    "name": "Lydia Kabs",
    "region": "United Kingdom",
    "country": "United Kingdom",
    "genre": "Gospel",
    "projects": []
  },
  {
    "name": "Samuel Refined",
    "region": "United Kingdom",
    "country": "United Kingdom",
    "genre": "Gospel",
    "projects": []
  },
  {
    "name": "Jason Nelson",
    "region": "America",
    "country": "United States",
    "genre": "Gospel",
    "projects": []
  },
  {
    "name": "Jonathan Nelson",
    "region": "America",
    "country": "United States",
    "genre": "Gospel",
    "projects": []
  },
  {
    "name": "Donnie McClurkin",
    "region": "America",
    "country": "United States",
    "genre": "Gospel",
    "projects": []
  },
  {
    "name": "Israel Houghton",
    "region": "America",
    "country": "United States",
    "genre": "Gospel",
    "projects": []
  },
  {
    "name": "Todd Galberth",
    "region": "America",
    "country": "United States",
    "genre": "Gospel",
    "projects": []
  },
  {
    "name": "Runtown",
    "region": "Africa",
    "country": "Nigeria",
    "genre": "Afrobeats",
    "projects": []
  },
  {
    "name": "Victony",
    "region": "Africa",
    "country": "Nigeria",
    "genre": "Afrobeats",
    "projects": []
  },
  {
    "name": "Maleek Berry",
    "region": "Africa",
    "country": "Nigeria",
    "genre": "Afrobeats",
    "projects": []
  },
  {
    "name": "BLAQBONES",
    "region": "Africa",
    "country": "Nigeria",
    "genre": "Mainstream",
    "projects": []
  },
  {
    "name": "Sarkodie",
    "region": "Africa",
    "country": "Ghana",
    "genre": "Mainstream",
    "projects": []
  },
  {
    "name": "Edem",
    "region": "Africa",
    "country": "Ghana",
    "genre": "Mainstream",
    "projects": []
  },
  {
    "name": "Lily Atkinson",
    "region": "United Kingdom",
    "country": "United Kingdom",
    "genre": "Mainstream",
    "projects": []
  }
];
function slug(name: string) { return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function stableId(value: string) {
  const hex = createHash('sha256').update('joe-wilson-artists:' + value).digest('hex');
  return hex.slice(0,8) + '-' + hex.slice(8,12) + '-4' + hex.slice(13,16) + '-8' + hex.slice(17,20) + '-' + hex.slice(20,32);
}
async function main() {
  const regionNames = ['Africa', 'United Kingdom', 'America'];
  for (const [orderIndex, name] of regionNames.entries()) await prisma.artistRegion.upsert({ where: { slug: slug(name) }, update: {}, create: { name, slug: slug(name), orderIndex } });
  for (const [orderIndex, artist] of roster.entries()) {
    await prisma.$transaction(async tx => {
      const region = await tx.artistRegion.findUniqueOrThrow({ where: { slug: slug(artist.region) } });
      const code = ({ Ghana: 'GH', Nigeria: 'NG', 'United Kingdom': 'GB', 'United States': 'US' } as Record<string,string>)[artist.country];
      const country = await tx.artistCountry.upsert({ where: { code }, update: {}, create: { code, name: artist.country, regionId: region.id } });
      const genre = await tx.artistGenre.upsert({ where: { slug: slug(artist.genre) }, update: {}, create: { name: artist.genre, slug: slug(artist.genre) } });
      const record = await tx.artist.upsert({ where: { slug: slug(artist.name) }, update: {}, create: { name: artist.name, slug: slug(artist.name), countryId: country.id, genreId: genre.id, orderIndex } });
      for (const [projectOrder, project] of artist.projects.entries()) {
        const projectId = stableId(artist.name + ':' + project.title);
        const exists = await tx.artistProject.findUnique({ where: { id: projectId } });
        if (exists) continue;
        await tx.artistProject.create({ data: { id: projectId, artistId: record.id, slug: slug(project.title).slice(0, 120) + '-' + projectId, title: project.title, orderIndex: projectOrder,
          videos: { create: { youtubeId: project.youtubeId } },
          credits: { create: project.role.split(' · ').map((role, index) => ({ role, orderIndex: index })) },
        } });
      }
    });
  }
  console.log('Imported 37 artists and six projects as drafts; existing records preserved. Review and publish through the admin.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
