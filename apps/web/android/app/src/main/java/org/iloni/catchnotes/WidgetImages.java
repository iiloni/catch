package org.iloni.catchnotes;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONObject;

final class WidgetImages {
    static Bitmap decode(JSONObject note) {
        String image = note.optString("image");
        if (image.isEmpty() || image.length() > 64000) return null;
        try {
            byte[] bytes = Base64.decode(image, Base64.DEFAULT);
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
            if (bounds.outWidth <= 0
                    || bounds.outHeight <= 0
                    || bounds.outWidth > 320
                    || bounds.outHeight > 320) return null;
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        } catch (IllegalArgumentException ignored) {
            return null;
        }
    }

    static void apply(RemoteViews views, JSONObject note) {
        Bitmap image = decode(note);
        views.setViewVisibility(R.id.widget_image, image == null ? View.GONE : View.VISIBLE);
        if (image == null)
            views.setImageViewResource(R.id.widget_image, android.R.color.transparent);
        else views.setImageViewBitmap(R.id.widget_image, image);
    }
}
