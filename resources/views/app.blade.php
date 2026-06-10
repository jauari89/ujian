<!doctype html>
<html lang="id">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Smart Exam</title>
        <script>
            (function () {
                try {
                    var saved = localStorage.getItem('exam-theme');
                    var theme = saved || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
                    document.documentElement.dataset.theme = theme;
                } catch (e) {
                    document.documentElement.dataset.theme = 'light';
                }
            })();
        </script>
        @unless (app()->environment('testing'))
            @vite(['resources/css/app.css', 'resources/js/app.jsx'])
        @endunless
    </head>
    <body>
        <div id="root"></div>
    </body>
</html>
