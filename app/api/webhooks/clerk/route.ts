/* eslint-disable camelcase */
import { clerkClient } from "@clerk/nextjs/server";
import { WebhookEvent } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { Webhook } from "svix";

import { createUser, deleteUser, updateUser } from "@/lib/actions/user.actions";

export async function POST(req: Request) {
  console.log("Webhook handler invoked");

  const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
  console.log("WEBHOOK_SECRET:", WEBHOOK_SECRET);

  if (!WEBHOOK_SECRET) {
    console.error("WEBHOOK_SECRET is not defined");
    throw new Error(
      "Please add WEBHOOK_SECRET from Clerk Dashboard to .env or .env.local"
    );
  }

  const headerPayload = headers();
  const svix_id = headerPayload.get("svix-id");
  const svix_timestamp = headerPayload.get("svix-timestamp");
  const svix_signature = headerPayload.get("svix-signature");

  console.log("Received headers:", {
    svix_id,
    svix_timestamp,
    svix_signature,
  });

  if (!svix_id || !svix_timestamp || !svix_signature) {
    console.error("Missing svix headers");
    return new Response("Error occurred -- no svix headers", {
      status: 400,
    });
  }

  const payload = await req.json();
  const body = JSON.stringify(payload);
  console.log("Received payload:", payload);

  const wh = new Webhook(WEBHOOK_SECRET);

  let evt: WebhookEvent;

  try {
    evt = wh.verify(body, {
      "svix-id": svix_id,
      "svix-timestamp": svix_timestamp,
      "svix-signature": svix_signature,
    }) as WebhookEvent;
    console.log("Webhook verified successfully:", evt);
  } catch (err) {
    console.error("Error verifying webhook:", err);
    return new Response("Error occurred during verification", {
      status: 400,
    });
  }

  const { id } = evt.data;
  const eventType = evt.type;

  console.log(`Processing event type: ${eventType}`);

  try {
    if (eventType === "user.created") {
      const {
        id,
        email_addresses,
        image_url,
        first_name,
        last_name,
        username,
      } = evt.data;

      const user = {
        clerkId: id,
        email: email_addresses[0].email_address,
        username: username!,
        firstName: first_name || "",
        lastName: last_name || "",
        photo: image_url,
      };

      console.log("Creating user:", user);
      const newUser = await createUser(user);
      console.log("New user created:", newUser);

      if (newUser) {
        await clerkClient.users.updateUserMetadata(id, {
          publicMetadata: {
            userId: newUser._id,
          },
        });
        console.log("Public metadata updated for user:", newUser._id);
      }

      return NextResponse.json({ message: "OK", user: newUser });
    }

    if (eventType === "user.updated") {
      const { id, image_url, first_name, last_name, username } = evt.data;

      const user = {
        firstName: first_name || "",
        lastName: last_name || "",
        username: username!,
        photo: image_url,
      };

      console.log("Updating user:", user);
      const updatedUser = await updateUser(id, user);
      console.log("User updated:", updatedUser);

      return NextResponse.json({ message: "OK", user: updatedUser });
    }

    if (eventType === "user.deleted") {
      const { id } = evt.data;

      console.log("Deleting user:", id);
      const deletedUser = await deleteUser(id!);
      console.log("User deleted:", deletedUser);

      return NextResponse.json({ message: "OK", user: deletedUser });
    }

    console.log(`Unhandled event type: ${eventType}`);
    console.log("Webhook body:", body);

    return new Response("", { status: 200 });
  } catch (error) {
    console.error("Error processing event:", error);
    return new Response("Error occurred during event processing", {
      status: 500,
    });
  }
}
