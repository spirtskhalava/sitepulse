import { Link, Route, Routes } from "react-router-dom";
import { Crawl } from "./pages/Crawl";
import { Home } from "./pages/Home";

export default function App() {
  return (
    <>
      <header className="site">
        <Link to="/" className="logo">SitePulse</Link>
        <span>technical seo audit</span>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/crawls/:id" element={<Crawl />} />
          <Route path="*" element={<p>Not found. <Link to="/">Back</Link></p>} />
        </Routes>
      </main>
    </>
  );
}
