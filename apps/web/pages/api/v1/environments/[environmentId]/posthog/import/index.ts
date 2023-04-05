import { getSessionOrUser, hasEnvironmentAccess } from "@/lib/api/apiHelper";
import { prisma } from "@formbricks/database";
import type { NextApiRequest, NextApiResponse } from "next";

interface FormbricksUser {
  userId: string;
  attributes: { [key: string]: string };
}

export default async function handle(req: NextApiRequest, res: NextApiResponse) {
  // Check Authentication
  const user: any = await getSessionOrUser(req, res);
  if (!user) {
    return res.status(401).json({ message: "Not authenticated" });
  }

  const environmentId = req.query?.environmentId?.toString();

  if (!environmentId) {
    return res.status(400).json({ message: "Missing environmentId" });
  }

  const hasAccess = await hasEnvironmentAccess(user, environmentId);
  if (hasAccess === false) {
    return res.status(403).json({ message: "Not authorized" });
  }

  // POST
  if (req.method === "POST") {
    // lastSyncedAt is the last time the environment was synced (iso string)
    const { users }: { users: FormbricksUser[] } = req.body;

    for (const user of users) {
      // check if user with this userId as attribute already exists
      const existingUser = await prisma.person.findFirst({
        where: {
          attributes: {
            some: {
              attributeClass: {
                name: "userId",
                environmentId,
              },
              value: user.userId,
            },
          },
        },
        select: {
          id: true,
          attributes: {
            select: {
              id: true,
              value: true,
              attributeClass: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      });

      if (!existingUser) {
        const attributeType: "noCode" = "noCode";
        // create user with this attributes (create or connect attribute with the same attributeClass name)
        await prisma.person.create({
          data: {
            attributes: {
              create: Object.keys(user.attributes).map((key) => ({
                value: user.attributes[key],
                attributeClass: {
                  connectOrCreate: {
                    where: {
                      name_environmentId: {
                        name: key,
                        environmentId,
                      },
                    },
                    create: {
                      name: key,
                      type: attributeType,
                      environment: {
                        connect: {
                          id: environmentId,
                        },
                      },
                    },
                  },
                },
              })),
            },
            environment: {
              connect: {
                id: environmentId,
              },
            },
          },
        });
      } else {
        // user already exists, loop through attributes and update or create them
        const attributeType: "noCode" = "noCode";
        for (const key of Object.keys(user.attributes)) {
          const existingAttribute = existingUser.attributes.find(
            (attribute) => attribute.attributeClass.name === key
          );
          if (existingAttribute) {
            // skip if value is the same
            if (existingAttribute.value === user.attributes[key]) {
              continue;
            }
            await prisma.attribute.update({
              where: {
                id: existingAttribute.id,
              },
              data: {
                value: user.attributes[key],
              },
            });
          } else {
            // create attribute
            await prisma.attribute.create({
              data: {
                value: user.attributes[key],
                attributeClass: {
                  connectOrCreate: {
                    where: {
                      name_environmentId: {
                        name: key,
                        environmentId,
                      },
                    },
                    create: {
                      name: key,
                      type: attributeType,
                      environment: {
                        connect: {
                          id: environmentId,
                        },
                      },
                    },
                  },
                },
                person: {
                  connect: {
                    id: existingUser.id,
                  },
                },
              },
            });
          }
        }
      }
    }

    return res.status(200).end();
  }

  // Unknown HTTP Method
  else {
    throw new Error(`The HTTP ${req.method} method is not supported by this route.`);
  }
}
