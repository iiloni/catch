package org.iloni.catchnotes;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ValueAnimator;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.drawable.AdaptiveIconDrawable;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.view.View;
import android.view.ViewGroup;
import android.view.animation.AccelerateInterpolator;
import android.view.animation.AnticipateInterpolator;
import android.view.animation.PathInterpolator;
import androidx.core.splashscreen.SplashScreenViewProvider;

/**
 * The launch screen once Android hands it to the app (ADR 0003): a soft glow breathes behind the
 * icon while the page loads, then the icon draws in on itself as the page fades in. With
 * animations off it only fades.
 */
final class LaunchScreenAnimation {
    private static final long GLOW_IN_MS = 400;
    private static final long BREATH_MS = 1100;
    private static final long COLLAPSE_MS = 450;
    private static final long REVEAL_DELAY_MS = 100;
    private static final long REVEAL_MS = 400;

    private final Activity activity;
    private final SplashScreenViewProvider provider;
    private final boolean animated;
    private final View icon;
    private View glow;
    private ValueAnimator breathing;

    LaunchScreenAnimation(Activity activity, SplashScreenViewProvider provider) {
        this.activity = activity;
        this.provider = provider;
        icon = iconView(provider);
        animated = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            && ValueAnimator.areAnimatorsEnabled()
            && icon != null
            && icon.getParent() instanceof ViewGroup
            && icon.getWidth() > 0;
    }

    /** Starts the glow, which keeps breathing until `finish`. */
    void breathe() {
        if (!animated) return;
        ViewGroup parent = (ViewGroup) icon.getParent();
        // The icon shows as a circle two thirds of its view's width; the glow fades out well
        // beyond that edge.
        int size = Math.round(icon.getWidth() * 1.4f);
        int color = iconColor();
        int clear = color & 0x00FFFFFF;
        GradientDrawable halo = new GradientDrawable();
        halo.setShape(GradientDrawable.OVAL);
        halo.setGradientType(GradientDrawable.RADIAL_GRADIENT);
        halo.setGradientRadius(size / 2f);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            halo.setColors(new int[] {color, color, clear}, new float[] {0f, 0.45f, 1f});
        } else {
            halo.setColors(new int[] {color, clear});
        }
        glow = new View(activity);
        glow.setBackground(halo);
        glow.setAlpha(0f);
        parent.addView(glow, parent.indexOfChild(icon), new ViewGroup.LayoutParams(size, size));
        glow.setX(icon.getX() + (icon.getWidth() - size) / 2f);
        glow.setY(icon.getY() + (icon.getHeight() - size) / 2f);

        breathing = ValueAnimator.ofFloat(0f, 1f).setDuration(BREATH_MS);
        breathing.setRepeatMode(ValueAnimator.REVERSE);
        breathing.setRepeatCount(ValueAnimator.INFINITE);
        breathing.setInterpolator(new PathInterpolator(0.37f, 0f, 0.63f, 1f));
        breathing.addUpdateListener((animation) -> {
            float breath = (float) animation.getAnimatedValue();
            float arriving = Math.min(1f, animation.getCurrentPlayTime() / (float) GLOW_IN_MS);
            glow.setAlpha(arriving * (0.25f + 0.3f * breath));
            glow.setScaleX(0.92f + 0.12f * breath);
            glow.setScaleY(0.92f + 0.12f * breath);
        });
        breathing.start();
    }

    /**
     * Collapses the icon while the launch screen's background fades into the page, then removes
     * it. Only the background fades, so the icon stays solid as it shrinks away over the page.
     */
    void finish() {
        if (breathing != null) breathing.cancel();
        View screen = provider.getView();
        PathInterpolator ease = new PathInterpolator(0.3f, 0f, 0.2f, 1f);
        Drawable backdrop = screen.getBackground();
        if (!animated || backdrop == null) {
            screen.animate().alpha(0f).setDuration(250).setInterpolator(ease).withEndAction(provider::remove).start();
            return;
        }
        icon.animate()
            .scaleX(0f)
            .scaleY(0f)
            .setDuration(COLLAPSE_MS)
            .setInterpolator(new AnticipateInterpolator(1.2f))
            .start();
        if (glow != null) {
            glow.animate()
                .scaleX(0f)
                .scaleY(0f)
                .alpha(0f)
                .setDuration(COLLAPSE_MS)
                .setInterpolator(new AccelerateInterpolator())
                .start();
        }
        Drawable fading = backdrop.mutate();
        ValueAnimator reveal = ValueAnimator.ofInt(255, 0).setDuration(REVEAL_MS);
        reveal.setStartDelay(REVEAL_DELAY_MS);
        reveal.setInterpolator(ease);
        reveal.addUpdateListener((animation) -> {
            fading.setAlpha((int) animation.getAnimatedValue());
            screen.invalidate();
        });
        reveal.addListener(new AnimatorListenerAdapter() {
            @Override
            public void onAnimationEnd(Animator animation) {
                provider.remove();
            }
        });
        reveal.start();
    }

    /** A launch screen without an icon, such as one Android shows for a widget, has no view. */
    private static View iconView(SplashScreenViewProvider provider) {
        try {
            return provider.getIconView();
        } catch (RuntimeException error) {
            return null;
        }
    }

    /** The average colour of the icon's background layer, which differs by channel. */
    private int iconColor() {
        int fallback = activity.getColor(R.color.colorPrimary);
        Drawable background;
        try {
            PackageManager manager = activity.getPackageManager();
            Drawable icon = manager.getActivityInfo(activity.getComponentName(), 0).loadIcon(manager);
            if (!(icon instanceof AdaptiveIconDrawable)) return fallback;
            background = ((AdaptiveIconDrawable) icon).getBackground();
        } catch (PackageManager.NameNotFoundException error) {
            return fallback;
        }
        if (background == null) return fallback;
        Bitmap sample = Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888);
        try {
            background.setBounds(0, 0, 8, 8);
            background.draw(new Canvas(sample));
            long red = 0, green = 0, blue = 0;
            int[] pixels = new int[64];
            sample.getPixels(pixels, 0, 8, 0, 0, 8, 8);
            for (int pixel : pixels) {
                red += Color.red(pixel);
                green += Color.green(pixel);
                blue += Color.blue(pixel);
            }
            return Color.rgb((int) (red / 64), (int) (green / 64), (int) (blue / 64));
        } finally {
            sample.recycle();
        }
    }
}
