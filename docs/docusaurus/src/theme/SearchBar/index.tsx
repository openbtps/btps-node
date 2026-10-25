import React, { useMemo, type ReactElement } from 'react';
import { Router, useHistory } from 'react-router-dom';
import type { History, LocationListener } from 'history';
import SearchBar from '@theme-original/SearchBar';

// The search box searches the whole site from every page; the results page keeps its section selector.
// The plugin picks the box's section from the router's location, so the box is given a history whose
// location is always the site's root, while every navigation it makes goes to the real history.
function atRoot(history: History): History {
  const root = (location: History['location']) => ({ ...location, pathname: '/' });
  return new Proxy(history, {
    get(target, key) {
      if (key === 'location') return root(target.location);
      if (key === 'listen')
        return (listener: LocationListener) =>
          target.listen((location, action) => listener(root(location), action));
      const value: unknown = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export default function SearchBarEverywhere(props: Record<string, unknown>): ReactElement {
  const history = useHistory();
  const everywhere = useMemo(() => atRoot(history), [history]);
  return (
    <Router history={everywhere}>
      <SearchBar {...props} />
    </Router>
  );
}
