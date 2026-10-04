import { Capacitor } from '@capacitor/core';
import type { Attachment } from '@catch/shared';
import { Camera, FilePlus2, Images, Mic, Square, Video, X } from 'lucide-react';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react';
import { type ComponentProps, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AnimatedHeight } from '@/components/AnimatedHeight/AnimatedHeight';
import type { EditorControls } from '@/components/NoteEditor/editorControls';
import { captureAttachmentInsertion } from '@/lib/attachmentInsertion';
import { attachFiles } from '@/lib/attachments';
import { haptics } from '@/lib/haptics';
import { pickNativeFiles, startNativeRecording, stopNativeRecording } from '@/lib/mediaPicker';

const native = Capacitor.isNativePlatform();
export function AttachmentPicker({
  noteId,
  onDone,
  controls,
}: {
  noteId: string;
  onDone: () => void;
  controls?: EditorControls | null;
}) {
  const mediaInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [capture, setCapture] = useState<'audio' | 'camera' | null>(null);
  const [busy, setBusy] = useState(false);
  const [direction, setDirection] = useState(1);
  const reducedMotion = useReducedMotion();
  const insert = useRef<Promise<((files: Attachment[]) => void) | null> | null>(null);

  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  function showCapture(kind: 'audio' | 'camera' | null) {
    setDirection(kind ? 1 : -1);
    setCapture(kind);
  }

  function rememberPosition() {
    insert.current = controls
      ? Promise.resolve(controls.attachmentInserter())
      : captureAttachmentInsertion(noteId);
  }
  async function receive(files: readonly File[]) {
    const insertion = insert.current;
    setBusy(true);
    showCapture(null);
    try {
      await attachFiles(noteId, files, (added) => {
        // A system picker can outlive the dock panel. Its captured insertion point still
        // belongs to the mounted editor; that editor ignores it after switching notes.
        void insertion?.then((insert) => insert?.(added));
      });
    } finally {
      if (active.current) {
        setBusy(false);
        onDone();
      }
    }
  }
  async function pick(kind: 'media' | 'files' | 'camera', video = false) {
    rememberPosition();
    haptics.selection();
    if (native) {
      setBusy(true);
      try {
        await receive(await pickNativeFiles(kind, video));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not open the picker');
        setBusy(false);
      }
    } else if (kind === 'camera') showCapture('camera');
    else (kind === 'media' ? mediaInput : fileInput).current?.click();
  }

  const slideVariants = {
    enter: (travel: number) => ({ x: reducedMotion ? 0 : travel * 32, opacity: 0 }),
    visible: { x: 0, opacity: 1 },
    leave: (travel: number) => ({ x: reducedMotion ? 0 : -travel * 32, opacity: 0 }),
  };

  return (
    <section
      aria-label="Add attachment"
      className="px-3 pt-3 pb-1"
      onPointerDown={(event) => event.preventDefault()}
    >
      <input
        ref={mediaInput}
        type="file"
        multiple
        accept="image/*,video/*"
        aria-label="Choose photos or videos"
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length) void receive(files);
        }}
      />
      <input
        ref={fileInput}
        type="file"
        multiple
        aria-label="Choose files"
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length) void receive(files);
        }}
      />
      <AnimatedHeight>
        <AnimatePresence initial={false} mode="wait" custom={direction}>
          <PickerView
            key={capture ?? 'options'}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="visible"
            exit="leave"
            transition={{ duration: reducedMotion ? 0 : 0.16 }}
          >
            {capture ? (
              native && capture === 'camera' ? (
                <div className="grid grid-cols-2 gap-2">
                  <PickerOption
                    label="Take photo"
                    icon={Camera}
                    onClick={() => void pick('camera')}
                    disabled={busy}
                  />
                  <PickerOption
                    label="Record video"
                    icon={Video}
                    onClick={() => void pick('camera', true)}
                    disabled={busy}
                  />
                  <button
                    type="button"
                    onClick={() => showCapture(null)}
                    className="col-span-2 py-2 text-sm text-muted-foreground"
                  >
                    Back
                  </button>
                </div>
              ) : (
                <CaptureMedia
                  kind={capture}
                  onSave={(file) => void receive([file])}
                  onCancel={() => showCapture(null)}
                />
              )
            ) : (
              <div className="grid grid-cols-2 gap-2" data-attachment-grid>
                <PickerOption
                  label="Photos & videos"
                  icon={Images}
                  disabled={busy}
                  onClick={() => void pick('media')}
                />
                <PickerOption
                  label="Camera"
                  icon={Camera}
                  disabled={busy}
                  onClick={() => {
                    rememberPosition();
                    showCapture('camera');
                  }}
                />
                <PickerOption
                  label="Record audio"
                  icon={Mic}
                  disabled={busy}
                  onClick={() => {
                    rememberPosition();
                    showCapture('audio');
                  }}
                />
                <PickerOption
                  label="Files"
                  icon={FilePlus2}
                  disabled={busy}
                  onClick={() => void pick('files')}
                />
              </div>
            )}
            {busy && (
              <p role="status" className="pt-2 text-center text-xs text-muted-foreground">
                Saving on this device…
              </p>
            )}
          </PickerView>
        </AnimatePresence>
      </AnimatedHeight>
    </section>
  );
}

function PickerView(props: ComponentProps<typeof motion.div>) {
  const isPresent = useIsPresent();
  return <motion.div {...props} inert={!isPresent} aria-hidden={!isPresent} />;
}

function PickerOption({
  label,
  icon: Icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: typeof Camera;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-2xl bg-foreground/5 px-2 py-3 text-sm text-foreground/80 outline-none hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
    >
      <Icon className="size-5" aria-hidden />
      {label}
    </button>
  );
}

function CaptureMedia({
  kind,
  onSave,
  onCancel,
}: {
  kind: 'audio' | 'camera';
  onSave: (file: File) => void;
  onCancel: () => void;
}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [ready, setReady] = useState(native && kind === 'audio');
  const [error, setError] = useState<string | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const nativeActive = useRef(false);
  const active = useRef(true);

  useEffect(() => {
    let cancelled = false;
    active.current = true;
    if (!(native && kind === 'audio')) {
      if (!navigator.mediaDevices?.getUserMedia)
        setError('Camera and recording need a secure connection (HTTPS).');
      else
        void navigator.mediaDevices
          .getUserMedia({
            audio: kind === 'audio',
            video: kind === 'camera' ? { facingMode: 'environment' } : false,
          })
          .then(
            (value) => {
              if (cancelled) {
                for (const track of value.getTracks()) track.stop();
                return;
              }
              stream.current = value;
              if (video.current) video.current.srcObject = value;
              setReady(true);
            },
            () => {
              if (!cancelled) setError('Allow access in your device settings, then try again.');
            },
          );
    }
    return () => {
      cancelled = true;
      active.current = false;
      if (recorder.current?.state === 'recording') recorder.current.stop();
      for (const track of stream.current?.getTracks() ?? []) track.stop();
      if (nativeActive.current) void stopNativeRecording(true).catch(() => {});
    };
  }, [kind]);
  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  async function start() {
    try {
      if (native && kind === 'audio') {
        await startNativeRecording();
        if (!active.current) {
          await stopNativeRecording(true);
          return;
        }
        nativeActive.current = true;
      } else {
        if (!stream.current || typeof MediaRecorder === 'undefined')
          throw new Error('Recording is not supported in this browser');
        if (kind === 'camera') {
          const sound = await navigator.mediaDevices.getUserMedia({ audio: true });
          if (!active.current || !stream.current) {
            for (const track of sound.getTracks()) track.stop();
            return;
          }
          for (const track of sound.getAudioTracks()) stream.current.addTrack(track);
        }
        const candidates =
          kind === 'audio'
            ? ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus']
            : ['video/webm;codecs=vp8,opus', 'video/mp4'];
        const mimeType = candidates.find((type) => MediaRecorder.isTypeSupported(type));
        const capture = new MediaRecorder(stream.current, mimeType ? { mimeType } : undefined);
        recorder.current = capture;
        const chunks: Blob[] = [];
        let bytes = 0;
        capture.ondataavailable = (event) => {
          chunks.push(event.data);
          bytes += event.data.size;
          if (bytes > 95 * 1024 * 1024 && capture.state === 'recording') capture.stop();
        };
        capture.onstop = () => {
          if (!active.current) return;
          const type =
            capture.mimeType.split(';')[0] || (kind === 'audio' ? 'audio/webm' : 'video/webm');
          const extension = type.includes('mp4')
            ? kind === 'audio'
              ? 'm4a'
              : 'mp4'
            : type.includes('ogg')
              ? 'ogg'
              : 'webm';
          setRecording(false);
          onSave(
            new File(
              chunks,
              `${kind === 'audio' ? 'Recording' : 'Video'} ${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`,
              { type },
            ),
          );
        };
        capture.start(1000);
      }
      setSeconds(0);
      setRecording(true);
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Could not start recording');
    }
  }
  async function stop() {
    if (native && kind === 'audio') {
      try {
        const file = await stopNativeRecording();
        nativeActive.current = false;
        setRecording(false);
        if (file) onSave(file);
      } catch {
        setError('Could not save the recording');
      }
    } else recorder.current?.stop();
  }
  function takePhoto() {
    const source = video.current;
    if (!source) return;
    const canvas = document.createElement('canvas');
    canvas.width = source.videoWidth;
    canvas.height = source.videoHeight;
    canvas.getContext('2d')?.drawImage(source, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob && active.current)
          onSave(new File([blob], `Photo ${Date.now()}.jpg`, { type: 'image/jpeg' }));
      },
      'image/jpeg',
      0.92,
    );
  }
  return (
    <fieldset
      className="flex flex-col gap-2"
      aria-label={kind === 'audio' ? 'Audio recorder' : 'Camera'}
    >
      {kind === 'camera' && (
        <video
          ref={video}
          muted
          autoPlay
          playsInline
          className="max-h-48 w-full rounded-2xl object-cover"
        />
      )}
      <p role="status" className="py-1 text-center text-sm">
        {error ??
          (recording
            ? `Recording · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
            : kind === 'audio'
              ? 'Record an audio note'
              : 'Take a photo or record a video')}
      </p>
      <div className="flex items-center justify-center gap-2">
        <button
          type="button"
          aria-label="Cancel capture"
          onClick={onCancel}
          className="flex size-11 items-center justify-center rounded-xl hover:bg-foreground/10"
        >
          <X className="size-5" />
        </button>
        {kind === 'camera' && !recording && (
          <button
            type="button"
            disabled={!ready}
            aria-label="Take photo"
            onClick={takePhoto}
            className="flex size-11 items-center justify-center rounded-xl bg-foreground/10 disabled:opacity-40"
          >
            <Camera className="size-5" />
          </button>
        )}
        <button
          type="button"
          disabled={!ready || Boolean(error)}
          onClick={() => void (recording ? stop() : start())}
          className="flex h-11 items-center gap-2 rounded-xl bg-foreground/10 px-3 disabled:opacity-40"
        >
          {recording ? (
            <Square className="size-4 fill-current" />
          ) : kind === 'audio' ? (
            <Mic className="size-5" />
          ) : (
            <Video className="size-5" />
          )}
          {recording ? 'Save recording' : 'Record'}
        </button>
      </div>
    </fieldset>
  );
}
