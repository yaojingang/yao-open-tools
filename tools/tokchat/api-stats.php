<?php
/**
 * Backward-compatible entry for API statistics.
 * The real UI now lives inside the admin shell so the sidebar stays visible.
 */

session_start();

if (!isset($_SESSION['admin_id'])) {
    header('Location: admin_login.php');
    exit;
}

header('Location: admin.php?tab=api_stats');
exit;
