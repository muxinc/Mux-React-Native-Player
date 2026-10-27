package com.mux.reactnativeplayer

import android.app.UiModeManager
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration

internal fun Context.isTelevision(): Boolean =
  (getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager)?.currentModeType ==
    Configuration.UI_MODE_TYPE_TELEVISION ||
    packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
