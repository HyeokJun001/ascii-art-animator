// Carry the source video's soundtrack into the MP4 export (WebCodecs AAC + mp4-muxer).

const AAC_CODEC = 'mp4a.40.2';
const AAC_BITRATE = 128_000;
const SAMPLE_RATE = 48_000;

// decodeAudioData has no partial decode: the whole file's PCM lands in memory (~23MB per minute).
// ponytail: skip audio above this size; stream-decode with WebCodecs AudioDecoder if long sources matter.
const MAX_AUDIO_SOURCE_BYTES = 300 * 1024 * 1024;

/** Decode the audio track of a video file. Returns null (never throws) if it has none or the browser can't decode/encode it. */
export async function decodeSourceAudio(file: File): Promise<AudioBuffer | null> {
  if (typeof AudioEncoder === 'undefined' || file.size > MAX_AUDIO_SOURCE_BYTES) return null;
  try {
    const ctx = new OfflineAudioContext(2, 1, SAMPLE_RATE);
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    const { supported } = await AudioEncoder.isConfigSupported({
      codec: AAC_CODEC,
      sampleRate: buffer.sampleRate,
      numberOfChannels: audioChannels(buffer),
      bitrate: AAC_BITRATE,
    });
    return supported ? buffer : null;
  } catch {
    return null; // no audio track, or container/codec not decodable
  }
}

export const audioChannels = (buffer: AudioBuffer) => Math.min(2, buffer.numberOfChannels);

/** Encode the first `seconds` of `buffer` as AAC and hand each chunk to the muxer. */
export async function encodeAacAudio(
  buffer: AudioBuffer,
  seconds: number,
  addChunk: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => void,
): Promise<void> {
  const { sampleRate } = buffer;
  const numberOfChannels = audioChannels(buffer);
  const encoder = new AudioEncoder({ output: addChunk, error: () => {} }); // errors surface via flush()
  encoder.configure({ codec: AAC_CODEC, sampleRate, numberOfChannels, bitrate: AAC_BITRATE });

  const total = Math.min(buffer.length, Math.round(seconds * sampleRate));
  for (let offset = 0; offset < total; offset += sampleRate) {
    const frames = Math.min(sampleRate, total - offset);
    const data = new Float32Array(frames * numberOfChannels);
    for (let c = 0; c < numberOfChannels; c++) {
      data.set(buffer.getChannelData(c).subarray(offset, offset + frames), c * frames);
    }
    const audioData = new AudioData({
      format: 'f32-planar',
      sampleRate,
      numberOfFrames: frames,
      numberOfChannels,
      timestamp: Math.round((offset / sampleRate) * 1_000_000),
      data,
    });
    encoder.encode(audioData);
    audioData.close();
  }
  await encoder.flush();
  encoder.close();
}
