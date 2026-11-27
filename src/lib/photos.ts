import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

/** Private bucket for every photo in a space; files live at <space_id>/<user_id>/<name>. */
export const PHOTO_BUCKET = 'proofs';

/** Longest side after compression. Plenty for a phone screen and keeps files around 200-500 KB. */
const MAX_SIDE = 1600;
const QUALITY = 0.7;

export type Photo = { uri: string; width: number; height: number };
export type PickResult = { photo: Photo } | { error: string } | null;

/**
 * Lets the person take or choose a photo, then shrinks and re-encodes it as JPEG
 * so uploads stay small (and HEIC from iPhones becomes a format every device shows).
 * Returns null when the person cancels.
 */
export async function pickPhoto(source: 'camera' | 'library'): Promise<PickResult> {
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, allowsEditing: false };
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return { error: 'Camera access is off. You can turn it on in your phone settings.' };
  }
  const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  const asset = !res.canceled ? res.assets[0] : undefined;
  if (!asset) return null;
  try {
    return { photo: await compress(asset) };
  } catch {
    return { error: "That photo couldn't be read. Try another one." };
  }
}

async function compress(asset: ImagePicker.ImagePickerAsset): Promise<Photo> {
  const ctx = ImageManipulator.manipulate(asset.uri);
  const { width, height } = asset;
  if (width > MAX_SIDE || height > MAX_SIDE) {
    ctx.resize(width >= height ? { width: MAX_SIDE } : { height: MAX_SIDE });
  }
  const image = await ctx.renderAsync();
  const out = await image.saveAsync({ format: SaveFormat.JPEG, compress: QUALITY });
  return { uri: out.uri, width: out.width, height: out.height };
}

/** Uploads a compressed photo to the space's folder and returns its storage path. */
export async function uploadPhoto(spaceId: string, userId: string, photo: Photo): Promise<{ path: string } | { error: string }> {
  const path = `${spaceId}/${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const body = await (await fetch(photo.uri)).arrayBuffer();
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, body, { contentType: 'image/jpeg' });
  if (error) return { error: `The photo didn't upload: ${error.message}` };
  return { path };
}

/** Deletes files from storage. Failures are ignored: the post is already gone either way. */
export async function removePhotos(paths: (string | null | undefined)[]) {
  const list = paths.filter((p): p is string => !!p);
  for (let i = 0; i < list.length; i += 100) {
    await supabase.storage.from(PHOTO_BUCKET).remove(list.slice(i, i + 100));
  }
}

/** Removes every photo in a space. Call before deleting the space; only the owner may. */
export async function removeSpacePhotos(spaceId: string) {
  const { data } = await supabase.rpc('space_photo_paths', { p_space: spaceId });
  await removePhotos((data as string[] | null) ?? []);
}

const SIGNED_URL_SECONDS = 60 * 60;
const urlCache = new Map<string, { url: string; expires: number }>();

/** Signed URLs for private photos, fetched in one batch and cached for most of their lifetime. */
export function usePhotoUrls(paths: (string | null | undefined)[]) {
  const key = [...new Set(paths.filter((p): p is string => !!p))].sort().join('|');
  const [fetched, setFetched] = useState<Record<string, string>>({});

  useEffect(() => {
    const now = Date.now();
    const missing = (key ? key.split('|') : []).filter((p) => !((urlCache.get(p)?.expires ?? 0) > now));
    if (!missing.length) return;
    let live = true;
    supabase.storage
      .from(PHOTO_BUCKET)
      .createSignedUrls(missing, SIGNED_URL_SECONDS)
      .then(({ data }) => {
        const got: Record<string, string> = {};
        for (const d of data ?? []) {
          if (d.path && d.signedUrl) {
            got[d.path] = d.signedUrl;
            urlCache.set(d.path, { url: d.signedUrl, expires: Date.now() + (SIGNED_URL_SECONDS - 300) * 1000 });
          }
        }
        if (live) setFetched((cur) => ({ ...cur, ...got }));
      });
    return () => {
      live = false;
    };
  }, [key]);

  // Cached URLs (possibly fetched by another screen) first, then this screen's fresh ones.
  const urls: Record<string, string> = {};
  for (const p of key ? key.split('|') : []) {
    const url = fetched[p] ?? urlCache.get(p)?.url;
    if (url) urls[p] = url;
  }
  return urls;
}
