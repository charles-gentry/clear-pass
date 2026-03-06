#!/usr/bin/env python3
"""Tests for clear-pass.py"""
import importlib.util
import sys
import os
import pytest
from datetime import datetime
from unittest.mock import patch, MagicMock

# Import module with hyphenated filename; register in sys.modules so patches work
_spec = importlib.util.spec_from_file_location(
    "clear_pass",
    os.path.join(os.path.dirname(__file__), "clear-pass.py"),
)
clear_pass = importlib.util.module_from_spec(_spec)
sys.modules["clear_pass"] = clear_pass
_spec.loader.exec_module(clear_pass)

haversine = clear_pass.haversine
select_cloud_cover = clear_pass.select_cloud_cover
get_forecasts = clear_pass.get_forecasts
load_sentinel_satellites = clear_pass.load_sentinel_satellites
find_passes = clear_pass.find_passes
get_clear_passes = clear_pass.get_clear_passes


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _forecast_response(times, cloud_covers):
    mock_resp = MagicMock()
    mock_resp.json.return_value = {
        "hourly": {"time": times, "cloud_cover": cloud_covers}
    }
    return mock_resp


_TLE_2A = (
    "SENTINEL-2A",
    "1 40697U 15028A   24001.50000000  .00000023  00000-0  17800-4 0  9999",
    "2 40697  98.5681  99.0000 0001036  90.0000 270.0000 14.30818600 12345",
)
_TLE_2B = (
    "SENTINEL-2B",
    "1 42063U 17013A   24001.50000000  .00000023  00000-0  17900-4 0  9999",
    "2 42063  98.5681 279.0000 0001036  90.0000 270.0000 14.30824600 67890",
)
_TLE_OTHER = (
    "LANDSAT-9",
    "1 49260U 21088A   24001.50000000  .00000023  00000-0  17800-4 0  9999",
    "2 49260  98.2171  99.0000 0001036  90.0000 270.0000 14.57333600 12345",
)


def _make_tle_text(*satellites):
    lines = []
    for name, tle1, tle2 in satellites:
        lines.extend([name, tle1, tle2])
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# haversine
# ---------------------------------------------------------------------------

class TestHaversine:
    def test_same_point_returns_zero(self):
        assert haversine(0, 0, 0, 0) == 0.0

    def test_same_nonzero_point_returns_zero(self):
        assert haversine(51.5, -0.1, 51.5, -0.1) == 0.0

    def test_london_to_paris_approx_340km(self):
        dist = haversine(51.5074, -0.1278, 48.8566, 2.3522)
        assert 330 < dist < 350

    def test_quarter_equatorial_circumference(self):
        # (0,0) to (0,90) = one quarter of Earth's circumference ≈ 10008 km
        dist = haversine(0, 0, 0, 90)
        assert 9990 < dist < 10020

    def test_symmetric(self):
        assert abs(haversine(10, 20, 30, 40) - haversine(30, 40, 10, 20)) < 1e-9

    def test_one_degree_latitude_approx_111km(self):
        dist = haversine(0, 0, 1, 0)
        assert 110 < dist < 112


# ---------------------------------------------------------------------------
# select_cloud_cover
# ---------------------------------------------------------------------------

class TestSelectCloudCover:
    def test_exact_time_match(self):
        forecasts = [("2024-01-01T10:00", 30), ("2024-01-01T11:00", 70)]
        assert select_cloud_cover(forecasts, datetime(2024, 1, 1, 11, 0)) == 70

    def test_picks_nearest_earlier_entry(self):
        forecasts = [("2024-01-01T12:00", 20), ("2024-01-01T13:00", 80)]
        # 12:10 is closer to 12:00 than 13:00
        assert select_cloud_cover(forecasts, datetime(2024, 1, 1, 12, 10)) == 20

    def test_picks_nearest_later_entry(self):
        forecasts = [("2024-01-01T12:00", 20), ("2024-01-01T13:00", 80)]
        # 12:50 is closer to 13:00 than 12:00
        assert select_cloud_cover(forecasts, datetime(2024, 1, 1, 12, 50)) == 80

    def test_single_entry_always_selected(self):
        forecasts = [("2024-01-01T06:00", 45)]
        # timestamp is far away but there is only one entry
        assert select_cloud_cover(forecasts, datetime(2024, 1, 5, 12, 0)) == 45

    def test_none_cover_raises_key_error(self):
        forecasts = [("2024-01-01T12:00", None)]
        with pytest.raises(KeyError):
            select_cloud_cover(forecasts, datetime(2024, 1, 1, 12, 0))

    def test_zero_percent_cover(self):
        forecasts = [("2024-01-01T12:00", 0)]
        assert select_cloud_cover(forecasts, datetime(2024, 1, 1, 12, 0)) == 0

    def test_hundred_percent_cover(self):
        forecasts = [("2024-01-01T12:00", 100)]
        assert select_cloud_cover(forecasts, datetime(2024, 1, 1, 12, 0)) == 100


# ---------------------------------------------------------------------------
# get_forecasts
# ---------------------------------------------------------------------------

class TestGetForecasts:
    @patch("clear_pass.requests.get")
    def test_returns_list_of_tuples(self, mock_get):
        times = ["2024-01-01T00:00", "2024-01-01T01:00"]
        covers = [10, 50]
        mock_get.return_value = _forecast_response(times, covers)
        result = get_forecasts(51.5, -0.1, days=1)
        assert result == [("2024-01-01T00:00", 10), ("2024-01-01T01:00", 50)]

    @patch("clear_pass.requests.get")
    def test_sends_correct_params(self, mock_get):
        mock_get.return_value = _forecast_response(["2024-01-01T00:00"], [30])
        get_forecasts(48.8566, 2.3522, days=7)
        params = mock_get.call_args[1]["params"]
        assert params["latitude"] == 48.8566
        assert params["longitude"] == 2.3522
        assert params["hourly"] == "cloud_cover"
        assert params["timezone"] == "UTC"
        assert params["forecast_days"] == 7

    @patch("clear_pass.requests.get")
    def test_forecast_days_capped_at_16(self, mock_get):
        mock_get.return_value = _forecast_response(["2024-01-01T00:00"], [30])
        get_forecasts(0, 0, days=20)
        params = mock_get.call_args[1]["params"]
        assert params["forecast_days"] == 16

    @patch("clear_pass.requests.get")
    def test_forecast_days_not_capped_below_16(self, mock_get):
        mock_get.return_value = _forecast_response(["2024-01-01T00:00"], [30])
        get_forecasts(0, 0, days=10)
        params = mock_get.call_args[1]["params"]
        assert params["forecast_days"] == 10

    @patch("clear_pass.requests.get")
    def test_empty_response_raises_runtime_error(self, mock_get):
        mock_get.return_value = _forecast_response([], [])
        with pytest.raises(RuntimeError, match="no data"):
            get_forecasts(0, 0)

    @patch("clear_pass.requests.get")
    def test_missing_hourly_key_raises_runtime_error(self, mock_get):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {}
        mock_get.return_value = mock_resp
        with pytest.raises(RuntimeError):
            get_forecasts(0, 0)

    @patch("clear_pass.requests.get")
    def test_http_error_propagates(self, mock_get):
        import requests as req_lib
        mock_get.return_value.raise_for_status.side_effect = req_lib.HTTPError("503")
        with pytest.raises(req_lib.HTTPError):
            get_forecasts(0, 0)


# ---------------------------------------------------------------------------
# load_sentinel_satellites
# ---------------------------------------------------------------------------

class TestLoadSentinelSatellites:
    @patch("clear_pass.EarthSatellite")
    @patch("clear_pass.requests.get")
    def test_loads_both_sentinels(self, mock_get, mock_sat_cls):
        mock_get.return_value.text = _make_tle_text(_TLE_2A, _TLE_2B)
        load_sentinel_satellites()
        assert mock_sat_cls.call_count == 2

    @patch("clear_pass.EarthSatellite")
    @patch("clear_pass.requests.get")
    def test_ignores_non_sentinel_entries(self, mock_get, mock_sat_cls):
        mock_get.return_value.text = _make_tle_text(_TLE_OTHER, _TLE_2A)
        load_sentinel_satellites()
        assert mock_sat_cls.call_count == 1

    @patch("clear_pass.requests.get")
    def test_no_matching_satellites_raises(self, mock_get):
        mock_get.return_value.text = _make_tle_text(_TLE_OTHER)
        with pytest.raises(RuntimeError, match="Failed to load"):
            load_sentinel_satellites()

    @patch("clear_pass.EarthSatellite")
    @patch("clear_pass.requests.get")
    def test_returns_satellite_objects(self, mock_get, mock_sat_cls):
        mock_get.return_value.text = _make_tle_text(_TLE_2A)
        mock_sat = MagicMock()
        mock_sat_cls.return_value = mock_sat
        assert load_sentinel_satellites() == [mock_sat]

    @patch("clear_pass.EarthSatellite")
    @patch("clear_pass.requests.get")
    def test_bad_tle_parse_skipped_not_raised(self, mock_get, mock_sat_cls):
        # First satellite's TLE fails to parse; second succeeds — no crash
        mock_get.return_value.text = _make_tle_text(_TLE_2A, _TLE_2B)
        mock_sat = MagicMock()
        mock_sat_cls.side_effect = [Exception("bad TLE"), mock_sat]
        result = load_sentinel_satellites()
        assert result == [mock_sat]

    @patch("clear_pass.EarthSatellite")
    @patch("clear_pass.requests.get")
    def test_all_tle_parse_failures_raises(self, mock_get, mock_sat_cls):
        mock_get.return_value.text = _make_tle_text(_TLE_2A, _TLE_2B)
        mock_sat_cls.side_effect = Exception("bad TLE")
        with pytest.raises(RuntimeError, match="Failed to load"):
            load_sentinel_satellites()

    @patch("clear_pass.requests.get")
    def test_http_error_propagates(self, mock_get):
        import requests as req_lib
        mock_get.return_value.raise_for_status.side_effect = req_lib.HTTPError("404")
        with pytest.raises(req_lib.HTTPError):
            load_sentinel_satellites()


# ---------------------------------------------------------------------------
# get_clear_passes
# ---------------------------------------------------------------------------

class TestGetClearPasses:
    @patch("clear_pass.get_forecasts")
    @patch("clear_pass.find_passes")
    def test_no_passes_returns_empty_list(self, mock_passes, mock_forecasts):
        mock_passes.return_value = []
        assert get_clear_passes(51.5, -0.1) == []
        mock_forecasts.assert_not_called()

    @patch("clear_pass.get_forecasts")
    @patch("clear_pass.find_passes")
    def test_cloudy_pass_excluded(self, mock_passes, mock_forecasts):
        t = datetime(2024, 1, 1, 10, 0)
        mock_passes.return_value = [t]
        mock_forecasts.return_value = [("2024-01-01T10:00", 90)]
        assert get_clear_passes(51.5, -0.1, cloud_threshold=20) == []

    @patch("clear_pass.get_forecasts")
    @patch("clear_pass.find_passes")
    def test_clear_pass_included(self, mock_passes, mock_forecasts):
        t = datetime(2024, 1, 1, 10, 0)
        mock_passes.return_value = [t]
        mock_forecasts.return_value = [("2024-01-01T10:00", 5)]
        assert get_clear_passes(51.5, -0.1, cloud_threshold=20) == [(t, 5)]

    @patch("clear_pass.get_forecasts")
    @patch("clear_pass.find_passes")
    def test_pass_at_exact_threshold_included(self, mock_passes, mock_forecasts):
        t = datetime(2024, 1, 1, 10, 0)
        mock_passes.return_value = [t]
        mock_forecasts.return_value = [("2024-01-01T10:00", 20)]
        assert get_clear_passes(51.5, -0.1, cloud_threshold=20) == [(t, 20)]

    @patch("clear_pass.get_forecasts")
    @patch("clear_pass.find_passes")
    def test_pass_one_above_threshold_excluded(self, mock_passes, mock_forecasts):
        t = datetime(2024, 1, 1, 10, 0)
        mock_passes.return_value = [t]
        mock_forecasts.return_value = [("2024-01-01T10:00", 21)]
        assert get_clear_passes(51.5, -0.1, cloud_threshold=20) == []

    @patch("clear_pass.get_forecasts")
    @patch("clear_pass.find_passes")
    def test_mixed_passes_filtered_correctly(self, mock_passes, mock_forecasts):
        t1 = datetime(2024, 1, 1, 6, 0)
        t2 = datetime(2024, 1, 1, 10, 0)
        t3 = datetime(2024, 1, 1, 14, 0)
        mock_passes.return_value = [t1, t2, t3]
        mock_forecasts.return_value = [
            ("2024-01-01T06:00", 5),   # clear
            ("2024-01-01T10:00", 80),  # cloudy
            ("2024-01-01T14:00", 15),  # clear
        ]
        result = get_clear_passes(51.5, -0.1, cloud_threshold=20)
        assert result == [(t1, 5), (t3, 15)]

    @patch("clear_pass.get_forecasts")
    @patch("clear_pass.find_passes")
    def test_days_forwarded_to_find_passes(self, mock_passes, mock_forecasts):
        mock_passes.return_value = []
        get_clear_passes(51.5, -0.1, cloud_threshold=30, days=5)
        mock_passes.assert_called_once_with(51.5, -0.1, 5)

    @patch("clear_pass.get_forecasts")
    @patch("clear_pass.find_passes")
    def test_days_forwarded_to_get_forecasts(self, mock_passes, mock_forecasts):
        t = datetime(2024, 1, 1, 10, 0)
        mock_passes.return_value = [t]
        mock_forecasts.return_value = [("2024-01-01T10:00", 5)]
        get_clear_passes(51.5, -0.1, cloud_threshold=20, days=7)
        mock_forecasts.assert_called_once_with(51.5, -0.1, 7)

    @patch("clear_pass.get_forecasts")
    @patch("clear_pass.find_passes")
    def test_select_error_skips_pass_gracefully(self, mock_passes, mock_forecasts):
        # If select_cloud_cover raises (e.g. None cover), the pass is skipped
        t = datetime(2024, 1, 1, 10, 0)
        mock_passes.return_value = [t]
        mock_forecasts.return_value = [("2024-01-01T10:00", None)]
        # Should not raise; bad pass is silently skipped
        assert get_clear_passes(51.5, -0.1, cloud_threshold=20) == []
