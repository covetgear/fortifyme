-- Check for wishlist alerts every hour (catches mid-day shop drops). alerts_sent prevents repeats.
select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'send-alerts-daily'), schedule := '20 * * * *');
select cron.unschedule('send-alerts-retry');
