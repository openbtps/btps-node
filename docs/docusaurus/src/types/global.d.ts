declare module '@theme/Heading' {
  import type { ComponentProps, ReactElement } from 'react';

  type HeadingType = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

  export interface Props extends ComponentProps<HeadingType> {
    readonly as: HeadingType;
  }

  export default function Heading(props: Props): ReactElement;
}

declare module '@docusaurus/Link' {
  import type { CSSProperties, ComponentProps, ReactElement } from 'react';
  import type { NavLinkProps as RRNavLinkProps } from 'react-router-dom';

  type NavLinkProps = Partial<RRNavLinkProps>;

  export type Props = NavLinkProps &
    ComponentProps<'a'> & {
      readonly className?: string;
      readonly style?: CSSProperties;
      readonly isNavLink?: boolean;
      readonly to?: string;
      readonly href?: string;
      readonly autoAddBaseUrl?: boolean;

      /** Escape hatch in case broken links check doesn't make sense. */
      readonly 'data-noBrokenLinkCheck'?: boolean;
    };

  export default function Link(props: Props): ReactElement;
}

declare module '@theme/Layout' {
  import type { ReactElement, ReactNode } from 'react';

  export interface Props {
    readonly children?: ReactNode;
    readonly title?: string;
    readonly description?: string;
    readonly keywords?: string | readonly string[];
    readonly wrapperClassName?: string;
    readonly pageClassName?: string;
    readonly noFooter?: boolean;
    readonly noScrollToTop?: boolean;
    readonly image?: string;
  }

  export default function Layout(props: Props): ReactElement;
}